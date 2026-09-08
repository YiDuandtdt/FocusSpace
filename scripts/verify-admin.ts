import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Browser } from '@playwright/test';
import type { Ack, RoomSnapshot, AdminAction, AdminImpact } from '@focusspace/shared';
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/admin-'));
const databaseUrl = 'file:' + resolve(directory, 'verify.db').replaceAll('\\', '/');
const database = new PrismaClient({ datasourceUrl: databaseUrl });
await database.$connect();
await database.$disconnect();
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
await new Promise<void>((done) => listener.close(() => done()));
const base = 'http://127.0.0.1:' + address.port;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: String(address.port),
  HOST: '127.0.0.1',
  APP_ORIGINS: base,
  DISCONNECT_GRACE_MS: '2500',
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
};
// Upgrade a real phase-five schema and preserve a legacy private room and user.
const legacy = resolve(directory, 'legacy');
mkdirSync(resolve(legacy, 'migrations'), { recursive: true });
writeFileSync(resolve(legacy, 'schema.prisma'), readFileSync('prisma/schema.prisma'));
for (const name of [
  '202609070001_init',
  '202609070002_sessions',
  '202609080001_recovery',
  '202609080002_feedback',
])
  cpSync(resolve('prisma/migrations', name), resolve(legacy, 'migrations', name), {
    recursive: true,
  });
cpSync('prisma/migrations/migration_lock.toml', resolve(legacy, 'migrations/migration_lock.toml'));
function deploy(schema = 'prisma/schema.prisma') {
  const r = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schema],
    { env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
deploy(resolve(legacy, 'schema.prisma'));
await database.$executeRawUnsafe(
  'INSERT INTO User (id,username,passwordHash,nickname) VALUES (?,?,?,?)',
  'legacy-user',
  'legacy-user',
  'unused',
  '旧账号',
);
await database.$executeRawUnsafe(
  'INSERT INTO StudySession (id,focusSeconds,breakSeconds,phase) VALUES (?,?,?,?)',
  'legacy-session',
  1500,
  300,
  'ENDED',
);
await database.$executeRawUnsafe(
  'INSERT INTO Room (id,code,name,ownerId,sessionId) VALUES (?,?,?,?,?)',
  'legacy-room',
  'LEGACY',
  '旧房间',
  'legacy-user',
  'legacy-session',
);
deploy();
assert.equal(
  (await database.room.findUniqueOrThrow({ where: { id: 'legacy-room' } })).visibility,
  'PRIVATE',
);
assert.equal(
  (await database.user.findUniqueOrThrow({ where: { id: 'legacy-user' } })).role,
  'USER',
);
let server: ChildProcess;
let log = '';
let browser: Browser | undefined;
const sockets: Socket[] = [];
async function waitFor(check: () => Promise<boolean> | boolean, label: string, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error('Timed out: ' + label + '\n' + log);
}
async function boot() {
  server = spawn(process.execPath, ['scripts/start.mjs'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  await waitFor(
    () =>
      fetch(base + '/api/health')
        .then((r) => r.ok)
        .catch(() => false),
    'boot',
  );
}
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await once(server, 'exit');
  }
}
type Actor = { id: string; cookie: string; username: string };
const password = 'PhaseSixVerify42!';
async function req(path: string, actor?: Actor, body?: unknown, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: {
      Origin: base,
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get('set-cookie')?.split(';')[0],
  };
}
async function actor(username: string) {
  const body = { username, nickname: username, password, role: 'ADMIN' };
  const registered = await req('/auth/register', undefined, body);
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.role, 'USER');
  const logged = await req('/auth/login', undefined, { username, password });
  assert.equal(logged.status, 200);
  return { id: registered.data.user.id, username, cookie: logged.cookie! };
}
async function connect(a: Actor) {
  const s = io(base, {
    transports: ['websocket'],
    extraHeaders: { Cookie: a.cookie, Origin: base },
    reconnection: false,
  });
  sockets.push(s);
  await Promise.race([
    once(s, 'connect'),
    once(s, 'connect_error').then(([e]) => Promise.reject(e)),
    new Promise((_, reject) => setTimeout(() => reject(Error('socket timeout')), 5000)),
  ]);
  return s;
}
const cmd = (
  s: Socket,
  type: string,
  roomId: string,
  payload: unknown = {},
  requestId = randomUUID(),
) =>
  new Promise<Ack>((resolve, reject) =>
    s
      .timeout(6000)
      .emit(type, { requestId, roomId, payload }, (e: Error | null, a: Ack) =>
        e ? reject(e) : resolve(a),
      ),
  );
async function ok(
  s: Socket,
  type: string,
  roomId: string,
  payload: unknown = {},
  requestId?: string,
) {
  const a = await cmd(s, type, roomId, payload, requestId);
  assert(a.ok, JSON.stringify(a));
  return a.data!;
}
async function make(a: Actor, name: string, visibility = 'PUBLIC') {
  const r = await req('/rooms', a, {
    name,
    visibility,
    focusSeconds: 60,
    breakSeconds: 60,
    requestId: randomUUID(),
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.data as { roomId: string; code: string; sessionId: string };
}
async function join(a: Actor, r: { roomId: string }) {
  const result = await req('/rooms/public/' + r.roomId + '/join', a, { requestId: randomUUID() });
  assert.equal(result.status, 200, JSON.stringify(result));
}
async function action(a: Actor, type: AdminAction['action'], id: string, reason = '验证管理操作') {
  const p = await req('/admin/preview', a, { action: type, targetId: id });
  assert.equal(p.status, 200);
  const body = {
    action: type,
    targetId: id,
    reason,
    requestId: randomUUID(),
    impactKey: p.data.impactKey,
  };
  return { result: await req('/admin/actions', a, body), body };
}
try {
  await boot();
  const admin = await actor('admin_six'),
    owner = await actor('owner_six'),
    guest = await actor('guest_six'),
    third = await actor('third_six'),
    outsider = await actor('outsider_six');
  const init = spawnSync(process.execPath, ['scripts/init-admin.mjs', 'admin_six', '--confirm'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(init.status, 0, init.stderr);
  assert.equal((await req('/admin/overview')).status, 401);
  assert.equal((await req('/admin/overview', guest)).status, 403);
  for (const kind of ['users', 'rooms', 'messages', 'audits'])
    assert.equal((await req('/admin/' + kind, guest)).status, 403);
  assert.equal((await fetch(base + '/admin', { headers: { Cookie: guest.cookie } })).status, 403);
  assert.equal(
    (
      await req(
        '/users/me',
        guest,
        { nickname: 'guest_six', avatarId: 'sage', role: 'ADMIN' },
        'PATCH',
      )
    ).data.user.role,
    'USER',
  );
  const protectedLast = await action(admin, 'user:ban', admin.id);
  assert.equal(protectedLast.result.data.error.code, 'LAST_ADMIN');
  assert.equal((await req('/admin/users?page=0', admin)).status, 400);
  assert.equal((await req('/admin/users?q=guest_six', admin)).data.total, 1);
  console.log(
    'PASS additive legacy migration, explicit bootstrap, HTTP/page privilege, role injection, last admin',
  );
  const room = await make(owner, '公开验证房间');
  await join(guest, room);
  await join(third, room);
  const a = await connect(owner),
    a2 = await connect(owner),
    b = await connect(guest),
    c = await connect(third);
  for (const s of [a, a2, b, c]) await ok(s, 'room:join', room.roomId);
  const metrics = (await req('/admin/overview', admin)).data;
  assert.equal(metrics.connections, 4);
  assert.equal(metrics.onlineUsers, 3);
  assert.equal(metrics.activeRooms, 1);
  let listing = (await req('/rooms/public')).data;
  assert.equal(listing.items.length, 1);
  assert.deepEqual(
    Object.keys(listing.items[0]).sort(),
    [
      'id',
      'name',
      'capacity',
      'members',
      'phase',
      'focusSeconds',
      'breakSeconds',
      'nextStartAt',
    ].sort(),
  );
  assert.equal((await req('/rooms/' + room.roomId + '/snapshot', admin)).status, 404);
  assert.equal(
    (await cmd(b, 'room:visibility', room.roomId, { visibility: 'PRIVATE' })).error?.code,
    'FORBIDDEN',
  );
  assert.equal(
    (await cmd(b, 'room:transfer', room.roomId, { targetId: third.id })).error?.code,
    'FORBIDDEN',
  );
  assert.equal((await cmd(b, 'session:end', room.roomId)).error?.code, 'FORBIDDEN');
  await ok(a, 'task:create', room.roomId, { title: 'PRIVATE_SENTINEL_123' });
  const adminRooms = (await req('/admin/rooms', admin)).data;
  assert(!JSON.stringify(adminRooms).includes('PRIVATE_SENTINEL_123'));
  assert(!JSON.stringify(adminRooms).includes(room.code));
  await ok(c, 'member:afk', room.roomId, { afk: true });
  assert.equal(
    (await cmd(a, 'room:transfer', room.roomId, { targetId: third.id })).error?.code,
    'CONFLICT',
  );
  await ok(c, 'member:afk', room.roomId, { afk: false });
  for (const s of [a, b, c]) await ok(s, 'member:ready', room.roomId, { ready: true });
  let started = await ok(a, 'session:start', room.roomId);
  const boundary = started.session.phaseEndAt;
  const seats = started.members.map((m) => [m.userId, m.seatIndex]);
  const transferId = randomUUID();
  const transferred = await ok(
    a,
    'room:transfer',
    room.roomId,
    { targetId: guest.id, leave: false },
    transferId,
  );
  assert.equal(transferred.room.ownerId, guest.id);
  assert.equal(transferred.session.phaseEndAt, boundary);
  assert.deepEqual(
    transferred.members.map((m) => [m.userId, m.seatIndex]),
    seats,
  );
  assert.equal(transferred.myTasks[0].title, 'PRIVATE_SENTINEL_123');
  await ok(a, 'room:transfer', room.roomId, { targetId: guest.id, leave: false }, transferId);
  assert.equal((await cmd(a, 'session:end', room.roomId)).error?.code, 'FORBIDDEN');
  const delisted = await action(admin, 'room:delist', room.roomId);
  assert.equal(delisted.result.status, 200);
  assert.equal((await req('/rooms/public')).data.total, 0);
  assert.equal(
    (await req('/rooms/public/' + room.roomId + '/join', outsider, { requestId: randomUUID() }))
      .data.error.code,
    'ROOM_NOT_PUBLIC',
  );
  assert.equal(
    (await cmd(b, 'room:visibility', room.roomId, { visibility: 'PUBLIC' })).error?.code,
    'FORBIDDEN',
  );
  assert(
    (
      await cmd(a, 'task:update', room.roomId, {
        taskId: transferred.myTasks[0].id,
        version: 1,
        completed: true,
      })
    ).ok,
  );
  console.log(
    'PASS distinct metrics, public DTO privacy, live transfer preserves session/tasks/seats, delist blocks new public joins',
  );
  // Pin a short phase boundary in isolated fixtures; no production timing bypass is added.
  await database.studySession.update({
    where: { id: room.sessionId },
    data: { phaseEndAt: new Date(Date.now() + 300) },
  });
  await waitFor(async () => {
    const r = await req('/rooms/' + room.roomId + '/snapshot', guest);
    return r.data.session.phase === 'BREAK';
  }, 'break');
  let received: RoomSnapshot | undefined;
  a.on('room:snapshot', (e) => (received = e.data));
  const chatId = randomUUID();
  await ok(b, 'chat:send', room.roomId, { content: 'REMOVE_SENTINEL_456' }, chatId);
  const message = await database.chatMessage.findFirstOrThrow({
    where: { sessionId: room.sessionId },
  });
  await waitFor(
    () => !!received?.recentMessages.some((m) => m.content === 'REMOVE_SENTINEL_456'),
    'message delivered',
  );
  const removed = await action(admin, 'message:remove', message.id);
  assert.equal(removed.result.status, 200);
  await waitFor(
    () => !!received?.recentMessages.some((m) => m.id === message.id && m.content === '消息已移除'),
    'message tombstone delivered',
  );
  assert.equal(
    (await cmd(b, 'chat:send', room.roomId, { content: 'REMOVE_SENTINEL_456' }, chatId)).error
      ?.code,
    'MESSAGE_REMOVED',
  );
  for (const path of ['/admin/messages', '/admin/audits', '/rooms/' + room.roomId + '/snapshot'])
    assert(
      !JSON.stringify((await req(path, path.includes('snapshot') ? owner : admin)).data).includes(
        'REMOVE_SENTINEL_456',
      ),
    );
  assert.equal(
    (await database.chatMessage.findUniqueOrThrow({ where: { id: message.id } })).content,
    '',
  );
  assert(!JSON.stringify(await database.commandReceipt.findMany()).includes('REMOVE_SENTINEL_456'));
  // Preview cannot be reused after the membership impact changes.
  const stalePreview = (
    await req('/admin/preview', admin, { action: 'user:ban', targetId: guest.id })
  ).data;
  await ok(c, 'member:afk', room.roomId, { afk: true });
  const staleResult = await req('/admin/actions', admin, {
    action: 'user:ban',
    targetId: guest.id,
    reason: '验证变化',
    requestId: randomUUID(),
    impactKey: stalePreview.impactKey,
  });
  assert.equal(staleResult.data.error.code, 'IMPACT_CHANGED');
  await ok(c, 'member:afk', room.roomId, { afk: false });
  const banned = await action(admin, 'user:ban', guest.id);
  assert.equal(banned.result.status, 200);
  await waitFor(() => !b.connected, 'ban disconnect');
  assert.equal((await req('/auth/me', guest)).status, 401);
  assert.equal(
    (await req('/rooms/public/' + room.roomId + '/join', guest, { requestId: randomUUID() }))
      .status,
    401,
  );
  assert.equal(
    (await req('/auth/login', undefined, { username: guest.username, password })).status,
    401,
  );
  const blocked = io(base, {
    transports: ['websocket'],
    extraHeaders: { Cookie: guest.cookie, Origin: base },
    reconnection: false,
  });
  sockets.push(blocked);
  const [connectError] = await once(blocked, 'connect_error');
  assert.equal(connectError.message, 'UNAUTHORIZED');
  const afterBan = await ok(a, 'room:sync', room.roomId);
  assert.equal(afterBan.room.ownerId, owner.id);
  assert(!afterBan.members.some((m) => m.userId === guest.id));
  const unban = await action(admin, 'user:unban', guest.id);
  assert.equal(unban.result.status, 200);
  assert.equal((await req('/auth/me', guest)).status, 401);
  const relog = await req('/auth/login', undefined, { username: guest.username, password });
  assert.equal(relog.status, 200);
  guest.cookie = relog.cookie!;
  console.log(
    'PASS message redaction including replay, stale impact rejection, owner ban succession, immediate revoke and blocked reconnect',
  );
  // Inject a real DB failure in audit insert: the room mutation must roll back.
  await database.$executeRawUnsafe(
    "CREATE TRIGGER fail_success_audit BEFORE INSERT ON AdminAudit WHEN NEW.result = 'SUCCESS' BEGIN SELECT RAISE(FAIL, 'injected audit failure'); END",
  );
  const failed = await action(admin, 'room:end', room.roomId);
  assert.equal(failed.result.status, 503);
  assert.notEqual(
    (await database.studySession.findUniqueOrThrow({ where: { id: room.sessionId } })).phase,
    'ENDED',
  );
  await database.$executeRawUnsafe('DROP TRIGGER fail_success_audit');
  const ended = await action(admin, 'room:end', room.roomId);
  assert.equal(ended.result.status, 200);
  const records = await database.studyRecord.findMany({ where: { sessionId: room.sessionId } });
  assert.equal(records.length, 3);
  assert.equal(
    (await req('/admin/actions', admin, ended.body)).data.auditId,
    ended.result.data.auditId,
  );
  await action(admin, 'room:end', room.roomId);
  assert.deepEqual(
    await database.studyRecord.findMany({ where: { sessionId: room.sessionId } }),
    records,
  );
  assert.equal(
    await database.adminAudit.count({
      where: { requestId: ended.body.requestId, result: 'SUCCESS' },
    }),
    1,
  );
  console.log(
    'PASS failed audit rolls back mutation, successful audit exactly once, forced end and settlement idempotence',
  );
  const succession = await make(owner, '断线接任');
  await join(guest, succession);
  await join(third, succession);
  await ok(a, 'room:join', succession.roomId);
  await ok(a2, 'room:join', succession.roomId);
  const b2 = await connect(guest);
  await ok(b2, 'room:join', succession.roomId);
  await ok(c, 'room:join', succession.roomId);
  await ok(b2, 'member:afk', succession.roomId, { afk: true });
  a.disconnect();
  await new Promise((r) => setTimeout(r, 2800));
  assert.equal(
    (await database.room.findUniqueOrThrow({ where: { id: succession.roomId } })).ownerId,
    owner.id,
  );
  a2.disconnect();
  await waitFor(
    async () =>
      (await database.room.findUniqueOrThrow({ where: { id: succession.roomId } })).ownerId ===
      third.id,
    'non-AFK successor',
    6500,
  );
  assert.equal(
    (await database.studySession.findUniqueOrThrow({ where: { id: succession.sessionId } })).phase,
    'LOBBY',
  );
  await join(owner, succession);
  const a3 = await connect(owner);
  let restored = await ok(a3, 'room:join', succession.roomId);
  assert(!restored.myPermissions.isOwner);
  await ok(b2, 'member:afk', succession.roomId, { afk: false });
  const leaveId = randomUUID();
  await ok(c, 'room:transfer', succession.roomId, { targetId: guest.id, leave: true }, leaveId);
  await ok(c, 'room:transfer', succession.roomId, { targetId: guest.id, leave: true }, leaveId);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(
    (await database.studySession.findUniqueOrThrow({ where: { id: succession.sessionId } })).phase,
    'LOBBY',
  );
  await ok(b2, 'member:leave', succession.roomId);
  restored = await ok(a3, 'room:sync', succession.roomId);
  assert(restored.myPermissions.isOwner);
  a3.disconnect();
  await waitFor(
    async () =>
      (await database.studySession.findUniqueOrThrow({ where: { id: succession.sessionId } }))
        .phase === 'ENDED',
    'no successor ends',
    6500,
  );
  console.log(
    'PASS multi-tab grace, non-AFK deterministic succession, former owner rejoin, transfer-and-leave retry, no stale timeout, no-successor end',
  );
  // Capacity race through the actual public route, all joins share existing membership checks.
  const occupants = [guest, third, outsider];
  for (let i = 0; i < 5; i++) occupants.push(await actor('capacity_' + i));
  const cap = await make(owner, '容量验证');
  const joins = await Promise.all(
    occupants.map((o) =>
      req('/rooms/public/' + cap.roomId + '/join', o, { requestId: randomUUID() }),
    ),
  );
  assert.equal(joins.filter((r) => r.status === 200).length, 7, JSON.stringify(joins));
  assert.equal(joins.filter((r) => r.data.error?.code === 'ROOM_FULL').length, 1);
  await action(admin, 'room:end', cap.roomId);
  assert.equal(
    (await req('/rooms/public/' + cap.roomId + '/join', owner, { requestId: randomUUID() })).data
      .error.code,
    'ROOM_ENDED',
  );
  console.log('PASS concurrent public capacity race and ended-room join rejection');
  // Browser verification uses production assets and the real confirmation flow.
  browser = await chromium.launch({
    headless: true,
    ...(existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
      ? { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }
      : {}),
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const [ctx, who] of [
    [adminContext, admin],
    [memberContext, owner],
  ] as const)
    await ctx.addCookies([
      { name: 'focusspace_session', value: who.cookie.split('=')[1], url: base },
    ]);
  const ap = await adminContext.newPage(),
    mp = await memberContext.newPage();
  const errors: string[] = [];
  for (const page of [ap, mp])
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error('BROWSER ERROR', e.message);
    });
  await ap.goto(base + '/admin');
  await expect(ap.getByRole('heading', { name: '管理共学空间' })).toBeVisible();
  await expect(ap.getByText('实时连接数', { exact: true })).toBeVisible();
  await ap.screenshot({ path: resolve(directory, 'admin-overview.png'), fullPage: true });
  await mp.goto(base);
  await expect(mp.getByRole('heading', { name: '公开共学房间' })).toBeVisible();
  await mp.getByLabel('房间名称', { exact: true }).fill('浏览器公开共学');
  await mp.getByLabel('房间可见性').selectOption('PUBLIC');
  await mp.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(mp.getByRole('heading', { name: '房主管理' })).toBeVisible();
  await expect(mp.getByRole('button', { name: '我准备好了' })).toBeEnabled();
  const browserRoom = await database.room.findFirstOrThrow({ where: { name: '浏览器公开共学' } });
  // Give the browser a real chat window and verify DOM redaction, not only socket data.
  await database.studySession.update({
    where: { id: browserRoom.sessionId },
    data: {
      phase: 'BREAK',
      roundNo: 1,
      startedAt: new Date(),
      phaseStartAt: new Date(),
      phaseEndAt: new Date(Date.now() + 60000),
    },
  });
  await mp.reload();
  await expect(mp.getByLabel('休息消息', { exact: true })).toBeVisible();
  await mp.getByLabel('休息消息', { exact: true }).fill('BROWSER_REMOVE_789');
  await mp.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(mp.getByRole('log')).toContainText('BROWSER_REMOVE_789');
  await ap.getByRole('button', { name: '有限期消息', exact: true }).click();
  await expect(ap.getByText('BROWSER_REMOVE_789', { exact: true })).toBeVisible();
  const article = ap.locator('article').filter({ hasText: 'BROWSER_REMOVE_789' });
  await article.getByRole('button', { name: '移除原文', exact: true }).click();
  await expect(ap.getByRole('dialog')).toContainText('此操作不能撤销');
  await ap.getByLabel('操作原因').fill('浏览器违规验证');
  await ap.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(mp.getByRole('log')).not.toContainText('BROWSER_REMOVE_789');
  await expect(mp.getByRole('log')).toContainText('消息已移除');
  await ap.getByRole('button', { name: '房间与 Session', exact: true }).click();
  await expect(ap.getByRole('heading', { name: '浏览器公开共学' })).toBeVisible();
  await ap.screenshot({ path: resolve(directory, 'admin-rooms.png'), fullPage: true });
  await mp.screenshot({ path: resolve(directory, 'owner-mobile.png'), fullPage: true });
  const publicContext = await browser.newContext();
  await publicContext.addCookies([
    { name: 'focusspace_session', value: outsider.cookie.split('=')[1], url: base },
  ]);
  const pp = await publicContext.newPage();
  await pp.goto(base);
  await expect(pp.getByRole('heading', { name: '浏览器公开共学' })).toBeVisible();
  await pp.screenshot({ path: resolve(directory, 'public-directory.png'), fullPage: true });
  await pp.getByRole('button', { name: '加入共学', exact: true }).click();
  await expect(pp.getByRole('heading', { name: '浏览器公开共学' })).toBeVisible();
  await expect(
    pp.getByText('你是中途加入，已立即同步当前阶段，从入座连接后开始个人计时。'),
  ).toBeVisible();
  await ap.getByRole('button', { name: '用户管理', exact: true }).click();
  await ap.getByLabel('搜索账号或昵称').fill('outsider_six');
  await ap.getByRole('button', { name: '搜索', exact: true }).click();
  await ap.getByRole('button', { name: '封禁', exact: true }).click();
  await ap.getByLabel('操作原因').fill('浏览器即时封禁验证');
  await ap.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(pp).toHaveURL(/login/);
  await expect(pp.getByRole('heading', { name: '浏览器公开共学' })).toBeHidden();
  await ap.getByRole('button', { name: '操作审计', exact: true }).click();
  await expect(ap.getByText('原因：浏览器即时封禁验证')).toBeVisible();
  assert.deepEqual(errors, []);
  await browser.close();
  browser = undefined;
  console.log(
    'PASS production browser admin confirmation/audit, public join, mobile owner controls, live message redaction and immediate ban redirect',
  );
  writeFileSync(
    resolve(directory, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        base,
        directory,
        checks: [
          'migration',
          'privilege',
          'ban',
          'public-join',
          'ownership',
          'message-removal',
          'audit-atomicity',
          'settlement',
          'production-browser',
        ],
      },
      null,
      2,
    ),
  );
  console.log('Artifacts: ' + directory);
} catch (e) {
  writeFileSync(resolve(directory, 'server.log'), log);
  for (const [i, ctx] of (browser?.contexts() ?? []).entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: resolve(directory, 'failure-' + i + '.png'), fullPage: true })
      .catch(() => undefined);
  throw e;
} finally {
  await browser?.close();
  for (const s of sockets) s.disconnect();
  await stop();
  await database.$disconnect();
}
