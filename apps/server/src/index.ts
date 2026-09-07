import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import {
  credentialsSchema,
  registerSchema,
  createRoomSchema,
  joinRoomSchema,
  profileSchema,
} from '@focusspace/shared';
import { db, serialize } from './db.js';
import { config } from './config.js';
import { AppError, publicError } from './errors.js';
import { authenticate, login, register, publicUser, sessionCookie } from './modules/auth.js';
import { bump, createRoom, currentRoom, joinRoom, snapshot } from './modules/room.js';
import { createRealtime } from './realtime/index.js';

await db.$connect();
await db.$queryRaw`PRAGMA journal_mode=WAL`;
// Reconfirm online identities after restart; nobody receives stale online status.
await db.$transaction(async (tx) => {
  const rooms = await tx.room.findMany({ where: { session: { phase: { not: 'ENDED' } } } });
  await tx.roomMember.updateMany({
    where: { leftAt: null, room: { session: { phase: { not: 'ENDED' } } } },
    data: { connectionState: 'DISCONNECTED', lastSeenAt: new Date() },
  });
  for (const room of rooms) await bump(tx, room.id);
});
const app = express();
app.disable('x-powered-by');
const server = createServer(app);
const realtime = createRealtime(server);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', (req, _res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    (!req.headers.origin || !config.origins.has(req.headers.origin))
  )
    return next(new AppError('FORBIDDEN', '请求来源不受信任', 403));
  next();
});
app.use(express.json({ limit: '16kb' }));
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: '登录或注册尝试过多，请 15 分钟后重试' } },
});
const writeLimit = rateLimit({
  windowMs: 60000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET',
  message: { error: { code: 'RATE_LIMITED', message: '操作太快，请稍后重试' } },
});
app.use('/api', writeLimit);
app.get('/api/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});
app.post('/api/auth/register', authLimit, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const user = await serialize(() => register(input));
  res.status(201).json({ user });
});
app.post('/api/auth/login', authLimit, async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  const result = await login(input.username, input.password);
  // Rotating a browser login revokes the old token and its open sockets.
  await serialize(async () => {
    try {
      const previous = await authenticate(req.headers.cookie);
      await db.authSession.update({ where: { id: previous.id }, data: { revokedAt: new Date() } });
      realtime.revoke(previous.id);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'UNAUTHORIZED')) throw error;
    }
  });
  res.setHeader('Set-Cookie', result.cookie);
  res.json({ user: result.user });
});
app.post('/api/auth/logout', async (req, res) => {
  await serialize(async () => {
    try {
      const auth = await authenticate(req.headers.cookie);
      await db.authSession.update({ where: { id: auth.id }, data: { revokedAt: new Date() } });
      realtime.revoke(auth.id);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'UNAUTHORIZED')) throw error;
    }
  });
  res.setHeader('Set-Cookie', sessionCookie('', new Date(0)));
  res.json({ ok: true });
});
app.get('/api/auth/me', async (req, res) => {
  const auth = await authenticate(req.headers.cookie);
  res.json({ user: publicUser(auth.user), currentRoomId: await currentRoom(auth.userId) });
});
app.patch('/api/users/me', async (req, res) => {
  const input = profileSchema.parse(req.body);
  const user = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: auth.userId }, data: input });
      const roomId = await currentRoom(auth.userId, tx);
      if (roomId) await bump(tx, roomId);
      return { user, roomId };
    });
    if (result.roomId) await realtime.broadcast(result.roomId);
    return publicUser(result.user);
  });
  res.json({ user });
});
app.post('/api/rooms', async (req, res) => {
  const input = createRoomSchema.parse(req.body);
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    return createRoom(auth.userId, input);
  });
  res.status(201).json(result);
});
app.post('/api/rooms/join', async (req, res) => {
  const input = joinRoomSchema.parse(req.body);
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    const result = await joinRoom(auth.userId, input);
    await realtime.broadcast(result.roomId, 'member:joined');
    return result;
  });
  res.json(result);
});
app.get('/api/rooms/:id/snapshot', async (req, res) => {
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    return snapshot(req.params.id as string, auth.userId);
  });
  res.json(result);
});
app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在', 404)));
const webPath = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webPath)) {
  app.use(express.static(webPath));
  app.get('/{*path}', (_req, res) => res.sendFile(`${webPath}/index.html`));
}
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  const malformed = error instanceof SyntaxError && 'body' in error;
  res
    .status(
      error instanceof AppError ? error.status : error instanceof ZodError || malformed ? 400 : 500,
    )
    .json({
      error: malformed ? { code: 'VALIDATION_ERROR', message: '请求格式无效' } : publicError(error),
    });
};
app.use(handleError);
server.listen(config.PORT, config.HOST, () =>
  console.log(`FocusSpace ready: http://${config.HOST}:${config.PORT}`),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  realtime.close();
  server.close(() => {
    void serialize(() => db.$disconnect()).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
