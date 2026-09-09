import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { rateLimit } from 'express-rate-limit';
import { ZodError, z } from 'zod';
import { adminActionSchema, requestIdSchema } from '@focusspace/shared';
import { publicRooms } from './modules/public.js';
import {
  requireAdmin,
  adminList,
  adminOverview,
  adminImpact,
  adminMutate,
} from './modules/admin.js';
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
import {
  bump,
  createRoom,
  currentRoom,
  joinRoom,
  snapshot,
  requireMember,
} from './modules/room.js';
import { createRealtime } from './realtime/index.js';
import { advanceRoom, recoverSessions } from './modules/session.js';
import { summary, history } from './modules/record.js';
import { retainData } from './modules/retention.js';
import { personalSpace, savePersonal, decodeAvatar } from './modules/personal.js';

await db.$connect();
await db.$queryRaw`PRAGMA journal_mode=WAL`;
await recoverSessions();
await retainData();
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
      const { removeAvatar, ...profile } = input;
      const user = await tx.user.update({
        where: { id: auth.userId },
        data: {
          ...profile,
          ...(removeAvatar ? { avatarImage: null, avatarVersion: { increment: 1 } } : {}),
        },
      });
      const roomId = await currentRoom(auth.userId, tx);
      if (roomId) await bump(tx, roomId);
      return { user, roomId };
    });
    if (result.roomId) await realtime.broadcast(result.roomId);
    return publicUser(result.user);
  });
  res.json({ user });
});
app.get('/api/users/me/space', async (req, res) => {
  const auth = await authenticate(req.headers.cookie);
  res.json(await personalSpace(auth.userId));
});
app.put('/api/users/me/space', async (req, res) => {
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    const personal = await savePersonal(auth.userId, req.body);
    const roomId = await currentRoom(auth.userId);
    if (roomId) await realtime.broadcast(roomId);
    return personal;
  });
  res.json(result);
});
app.post(
  '/api/users/me/avatar',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
  async (req, res) => {
    await authenticate(req.headers.cookie);
    const avatarImage = await decodeAvatar(
      req.body,
      req.headers['content-type']?.split(';')[0] ?? '',
    );
    const user = await serialize(async () => {
      const auth = await authenticate(req.headers.cookie);
      const user = await db.user.update({
        where: { id: auth.userId },
        data: { avatarImage, avatarVersion: { increment: 1 } },
      });
      const roomId = await currentRoom(auth.userId);
      if (roomId) {
        await bump(db, roomId);
        await realtime.broadcast(roomId);
      }
      return publicUser(user);
    });
    res.json({ user });
  },
);
app.get('/api/avatars/:id', async (req, res) => {
  await authenticate(req.headers.cookie);
  const user = await db.user.findUnique({
    where: { id: req.params.id as string },
    select: { avatarImage: true },
  });
  if (!user?.avatarImage) throw new AppError('NOT_FOUND', '头像不存在', 404);
  res.type('png').send(Buffer.from(user.avatarImage));
});
app.post('/api/rooms', async (req, res) => {
  const input = createRoomSchema.parse(req.body);
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    return createRoom(auth.userId, input);
  });
  res.status(201).json(result);
});
app.get('/api/rooms/public', async (req, res) => {
  res.json(
    await serialize(async () => {
      const due = await db.room.findMany({
        where: { visibility: 'PUBLIC', session: { phase: { not: 'ENDED' } } },
        select: { id: true },
      });
      for (const room of due)
        if (await advanceRoom(room.id)) await realtime.broadcast(room.id, 'phase:change');
      return publicRooms(req.query);
    }),
  );
});
app.post('/api/rooms/public/:id/join', async (req, res) => {
  const input = z.object({ requestId: requestIdSchema }).strict().parse(req.body);
  res.json(
    await serialize(async () => {
      const auth = await authenticate(req.headers.cookie);
      const roomId = req.params.id as string;
      if (await advanceRoom(roomId)) await realtime.broadcast(roomId, 'phase:change');
      const result = await joinRoom(auth.userId, { ...input, publicRoomId: roomId });
      await realtime.broadcast(result.roomId, 'member:joined');
      return result;
    }),
  );
});
app.post('/api/rooms/join', async (req, res) => {
  const input = joinRoomSchema.parse(req.body);
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    const target = await db.room.findUnique({ where: { code: input.code }, select: { id: true } });
    if (target && (await advanceRoom(target.id)))
      await realtime.broadcast(target.id, 'phase:change');
    const result = await joinRoom(auth.userId, input);
    await realtime.broadcast(result.roomId, 'member:joined');
    return result;
  });
  res.json(result);
});
app.get('/api/rooms/:id/snapshot', async (req, res) => {
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    await requireMember(req.params.id as string, auth.userId, db, true);
    if (await advanceRoom(req.params.id as string))
      await realtime.broadcast(req.params.id as string, 'phase:change');
    return snapshot(req.params.id as string, auth.userId);
  });
  res.json(result);
});
app.get('/api/users/me/history', async (req, res) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new AppError('VALIDATION_ERROR', '页码无效', 400);
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    return history(auth.userId, page);
  });
  res.json(result);
});
app.get('/api/sessions/:id/summary', async (req, res) => {
  const result = await serialize(async () => {
    const auth = await authenticate(req.headers.cookie);
    return summary(req.params.id as string, auth.userId);
  });
  res.json(result);
});
app.use('/admin', async (req, res, next) => {
  try {
    await requireAdmin(req.headers.cookie);
    res.setHeader('Cache-Control', 'no-store');
    next();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      res.redirect('/login?next=/admin');
      return;
    }
    next(error);
  }
});
app.get('/api/admin/overview', async (req, res) => {
  res.json(
    await serialize(async () => {
      await requireAdmin(req.headers.cookie);
      return adminOverview(realtime.metrics());
    }),
  );
});
app.get('/api/admin/:kind', async (req, res) => {
  res.json(
    await serialize(async () => {
      await requireAdmin(req.headers.cookie);
      return adminList(req.params.kind as string, req.query);
    }),
  );
});
app.post('/api/admin/preview', async (req, res) => {
  const input = adminActionSchema.pick({ action: true, targetId: true }).parse(req.body);
  res.json(
    await serialize(async () => {
      await requireAdmin(req.headers.cookie);
      return adminImpact(input.action, input.targetId);
    }),
  );
});
app.post('/api/admin/actions', async (req, res) => {
  res.json(
    await serialize(async () => {
      const auth = await requireAdmin(req.headers.cookie);
      const result = await adminMutate(auth.userId, req.body);
      if (result.revokedUserId) realtime.revokeUser(result.revokedUserId);
      for (const roomId of result.roomIds) await realtime.broadcast(roomId, 'admin:changed');
      return { auditId: result.auditId };
    }),
  );
});
app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在', 404)));
const webPath = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webPath)) {
  app.use('/assets', express.static(`${webPath}/assets`, { immutable: true, maxAge: '1y' }));
  app.use(
    express.static(webPath, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }),
  );
  app.use(['/assets', '/audio'], (_req, res) => res.status(404).end());
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(`${webPath}/index.html`);
  });
}
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: { code: 'VALIDATION_ERROR', message: '文件或请求过大，头像最多 2 MB' } });
    return;
  }
  const malformed = error instanceof SyntaxError && 'body' in error;
  const detail = malformed
    ? { code: 'VALIDATION_ERROR', message: '请求格式无效' }
    : publicError(error);
  res
    .status(
      error instanceof AppError
        ? error.status
        : error instanceof ZodError || malformed
          ? 400
          : detail.code === 'DATABASE_UNAVAILABLE'
            ? 503
            : 500,
    )
    .json({
      error: detail,
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
