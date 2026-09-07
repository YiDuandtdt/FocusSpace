import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Browser } from '@playwright/test';
import type { Ack, RoomSnapshot, ChatEvent } from '@focusspace/shared';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/session-'));
const databaseUrl = `file:${resolve(directory, 'verify.db').replaceAll('\\', '/')}`;
process.env.DATABASE_URL = databaseUrl;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
await database.$connect();
await database.$disconnect();
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
await new Promise<void>((done) => listener.close(() => done()));
const base = `http://127.0.0.1:${address.port}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: String(address.port),
  HOST: '127.0.0.1',
  APP_ORIGINS: base,
  DISCONNECT_GRACE_MS: '3000',
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
};
const migration = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { env, encoding: 'utf8', windowsHide: true },
);
assert.equal(migration.status, 0, migration.stdout + migration.stderr);
let server: ChildProcess;
let processLog = '';
const sockets: Socket[] = [];
let browser: Browser | undefined;
async function waitFor(check: () => Promise<boolean> | boolean, message: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out: ${message}\n${processLog}`);
}
async function boot() {
  server = spawn(process.execPath, ['apps/server/dist/index.js'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (data) => (processLog += data.toString()));
  server.stderr?.on('data', (data) => (processLog += data.toString()));
  await waitFor(
    () =>
      fetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false),
    'server startup',
  );
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
}
type Actor = { id: string; cookie: string; username: string };
async function request(path: string, actor?: Actor, body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
async function actor(username: string): Promise<Actor> {
  const body = { username, nickname: username, password: 'SessionStudy42!' };
  const registered = await request('/auth/register', undefined, body);
  assert.equal(registered.status, 201);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(login.status, 200);
  return {
    id: registered.data.user.id,
    username,
    cookie: login.headers.get('set-cookie')!.split(';')[0],
  };
}
async function connect(actor: Actor) {
  const socket = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: actor.cookie, Origin: base },
    reconnection: false,
  });
  sockets.push(socket);
  const connected = new Promise<Socket>((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  socket.connect();
  return connected;
}
function command(
  socket: Socket,
  type: string,
  roomId: string,
  payload: unknown = {},
  requestId = crypto.randomUUID(),
) {
  return new Promise<Ack>((resolve, reject) =>
    socket
      .timeout(8000)
      .emit(type, { roomId, payload, requestId }, (error: Error | null, ack: Ack) =>
        error ? reject(error) : resolve(ack),
      ),
  );
}
const input = (name: string) => ({
  name,
  focusSeconds: 1500,
  breakSeconds: 300,
  requestId: crypto.randomUUID(),
});

try {
  await boot();
  const owner = await actor('session_owner'),
    guest = await actor('session_guest'),
    outsider = await actor('session_outside');
  const room = (await request('/rooms', owner, input('核心闭环验证'))).data;
  const a = await connect(owner),
    b = await connect(guest),
    x = await connect(outsider);
  await command(a, 'room:join', room.roomId);
  await request('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
  await command(b, 'room:join', room.roomId);
  assert.equal((await command(a, 'session:start', room.roomId)).error?.code, 'NOT_READY');
  assert.equal((await command(b, 'session:start', room.roomId)).error?.code, 'FORBIDDEN');
  assert.equal((await command(b, 'session:end', room.roomId)).error?.code, 'FORBIDDEN');
  assert.equal((await command(x, 'task:create', room.roomId, { title: 'hack' })).ok, false);
  await command(a, 'room:configure', room.roomId, { focusSeconds: 45, breakSeconds: 15 });
  assert.equal(
    (await command(a, 'chat:send', room.roomId, { content: 'Lobby blocked' })).error?.code,
    'INVALID_PHASE',
  );

  const taskIdempotency = crypto.randomUUID();
  const created = await command(
    b,
    'task:create',
    room.roomId,
    { title: 'PRIVATE_TITLE_量子作业' },
    taskIdempotency,
  );
  const task = created.data!.myTasks[0];
  await command(
    b,
    'task:create',
    room.roomId,
    { title: 'PRIVATE_TITLE_量子作业' },
    taskIdempotency,
  );
  assert.equal(
    await database.task.count({ where: { sessionId: room.sessionId, userId: guest.id } }),
    1,
  );
  assert.equal(
    (await command(b, 'task:create', room.roomId, { title: 'different' }, taskIdempotency)).error
      ?.code,
    'CONFLICT',
  );
  assert.equal(
    (await command(a, 'task:update', room.roomId, { taskId: task.id, version: 1, completed: true }))
      .error?.code,
    'NOT_FOUND',
  );
  const tab = await connect(guest);
  await command(tab, 'room:join', room.roomId);
  let latest: RoomSnapshot | undefined;
  let privateBroadcast = '';
  a.on('room:snapshot', (event) => {
    latest = event.data;
    privateBroadcast += JSON.stringify(event);
  });
  const raced = await Promise.all([
    command(b, 'task:update', room.roomId, { taskId: task.id, version: 1, completed: true }),
    command(tab, 'task:update', room.roomId, { taskId: task.id, version: 1, title: 'conflicting' }),
  ]);
  assert.equal(raced.filter((r) => r.ok).length, 1);
  assert.equal(raced.filter((r) => r.error?.code === 'CONFLICT').length, 1);
  let current = (await command(b, 'room:sync', room.roomId)).data!.myTasks[0];
  await command(b, 'task:update', room.roomId, {
    taskId: task.id,
    version: current.version,
    title: 'PRIVATE_TITLE_完成论文',
    completed: true,
  });
  await waitFor(
    () => latest?.members.find((m) => m.userId === guest.id)?.tasksDone === 1,
    'public progress',
  );
  assert.equal(privateBroadcast.includes('PRIVATE_TITLE'), false);
  assert.equal(latest!.myTasks.length, 0);
  current = (await command(tab, 'room:sync', room.roomId)).data!.myTasks[0];
  await command(tab, 'task:update', room.roomId, {
    taskId: task.id,
    version: current.version,
    completed: false,
  });
  assert.equal((await command(b, 'room:sync', room.roomId)).data!.myTasks[0].completedAt, null);
  const disposable = (
    await command(b, 'task:create', room.roomId, { title: 'delete me' })
  ).data!.myTasks.find((t) => t.title === 'delete me')!;
  await command(b, 'task:delete', room.roomId, {
    taskId: disposable.id,
    version: disposable.version,
  });
  assert.equal(await database.task.count({ where: { id: disposable.id } }), 0);
  console.log(
    'PASS private task CRUD, completion reversal, multi-tab version conflicts, receipts and public progress',
  );

  await command(a, 'member:ready', room.roomId, { ready: true });
  await command(b, 'member:ready', room.roomId, { ready: true });
  await command(b, 'member:afk', room.roomId, { afk: true });
  assert.equal((await command(a, 'session:start', room.roomId)).error?.code, 'NOT_READY');
  await command(b, 'member:afk', room.roomId, { afk: false });
  const startId = crypto.randomUUID();
  const started = await command(a, 'session:start', room.roomId, {}, startId);
  assert.equal(started.data?.session.phase, 'FOCUS');
  assert.equal(
    (await command(a, 'session:start', room.roomId, {}, startId)).data?.session.phaseEndAt,
    started.data!.session.phaseEndAt,
  );
  assert.equal((await command(a, 'session:start', room.roomId)).error?.code, 'INVALID_PHASE');
  assert.equal(
    (await command(b, 'chat:send', room.roomId, { content: 'Focus blocked' })).error?.code,
    'INVALID_PHASE',
  );
  assert.equal(
    (await command(a, 'room:configure', room.roomId, { focusSeconds: 1500, breakSeconds: 300 }))
      .error?.code,
    'INVALID_PHASE',
  );
  assert.equal(
    (await command(b, 'member:ready', room.roomId, { ready: false })).error?.code,
    'INVALID_PHASE',
  );
  b.disconnect();
  assert.equal(
    (await command(tab, 'room:sync', room.roomId)).data!.members.find((m) => m.userId === guest.id)!
      .status,
    'FOCUSING',
  );
  assert.equal(
    await database.presenceInterval.count({
      where: { sessionId: room.sessionId, userId: guest.id, endAt: null },
    }),
    1,
  );
  await command(tab, 'member:afk', room.roomId, { afk: true });
  assert.equal(
    await database.presenceInterval.count({
      where: { sessionId: room.sessionId, userId: guest.id, endAt: null },
    }),
    0,
  );
  await command(tab, 'member:afk', room.roomId, { afk: false });

  // Move only this isolated test database's timeline, never add a client phase-switch API.
  const start = new Date(Date.now() - 45020);
  await database.$transaction(async (tx) => {
    await tx.studySession.update({
      where: { id: room.sessionId },
      data: {
        startedAt: start,
        phaseStartAt: start,
        phaseEndAt: new Date(start.getTime() + 45000),
      },
    });
    await tx.phaseInterval.updateMany({
      where: { sessionId: room.sessionId, roundNo: 1 },
      data: { startAt: start },
    });
  });
  const rest = await command(tab, 'room:sync', room.roomId);
  assert.equal(rest.data?.session.phase, 'BREAK');
  assert.equal(rest.data?.session.roundNo, 1);
  const chats: ChatEvent[] = [];
  a.on('chat:message', (event) => chats.push(event));
  const chatId = crypto.randomUUID();
  assert.equal(
    (
      await command(
        tab,
        'chat:send',
        room.roomId,
        { content: '<img src=x onerror=alert(1)> hello' },
        chatId,
      )
    ).ok,
    true,
  );
  assert.equal(
    (await command(tab, 'chat:send', room.roomId, { content: 'too fast' })).error?.code,
    'RATE_LIMITED',
  );
  assert.equal(
    (
      await command(
        tab,
        'chat:send',
        room.roomId,
        { content: '<img src=x onerror=alert(1)> hello' },
        chatId,
      )
    ).ok,
    true,
  );
  assert.equal(await database.chatMessage.count({ where: { sessionId: room.sessionId } }), 1);
  await waitFor(() => chats.length > 0, 'break chat broadcast');
  assert.equal(
    (await command(a, 'chat:send', room.roomId, { content: 'x'.repeat(501) })).ok,
    false,
  );
  assert.equal((await command(a, 'chat:send', room.roomId, { content: '   ' })).ok, false);
  await database.studySession.update({
    where: { id: room.sessionId },
    data: { phaseEndAt: new Date(Date.now() - 1) },
  });
  assert.equal(
    (await command(tab, 'chat:send', room.roomId, { content: 'stale break client' })).error?.code,
    'INVALID_PHASE',
  );
  const roundTwo = await command(tab, 'room:sync', room.roomId);
  assert.equal(roundTwo.data?.session.roundNo, 2);
  assert.equal(roundTwo.data?.session.phase, 'FOCUS');
  console.log(
    'PASS readiness/owner guards, authoritative phase catch-up, AFK/multi-tab presence, chat boundary/length/rate/idempotency',
  );

  // Crash-style restart: last persisted heartbeat closes intervals, downtime earns no credit.
  const savedSeen = new Date();
  await database.roomMember.updateMany({
    where: { roomId: room.roomId },
    data: { lastSeenAt: savedSeen },
  });
  await stop();
  for (const s of sockets) s.disconnect();
  await boot();
  const recoveredA = await connect(owner),
    recoveredB = await connect(guest);
  const restored = await command(recoveredA, 'room:join', room.roomId);
  await command(recoveredB, 'room:join', room.roomId);
  assert.equal(restored.data?.session.roundNo, 2);
  assert.equal(restored.data?.session.phaseEndAt, roundTwo.data!.session.phaseEndAt);
  const closed = await database.presenceInterval.findMany({
    where: { sessionId: room.sessionId, endReason: 'SERVER_RESTART' },
  });
  assert(closed.length >= 1);
  assert(closed.every((p) => p.endAt!.getTime() <= savedSeen.getTime()));
  assert.equal((await command(recoveredB, 'room:sync', room.roomId)).data!.myTasks.length, 1);
  const endId = crypto.randomUUID();
  const ended = await command(recoveredA, 'session:end', room.roomId, {}, endId);
  assert.equal(ended.data?.session.phase, 'ENDED');
  const endAgain = await command(recoveredA, 'session:end', room.roomId);
  await command(recoveredA, 'session:end', room.roomId, {}, endId);
  assert.deepEqual(endAgain.data?.summary, ended.data?.summary);
  assert.equal(await database.studyRecord.count({ where: { sessionId: room.sessionId } }), 2);
  assert.equal(
    await database.presenceInterval.count({ where: { sessionId: room.sessionId, endAt: null } }),
    0,
  );
  assert.equal(
    (await command(recoveredB, 'task:create', room.roomId, { title: 'frozen' })).error?.code,
    'ROOM_ENDED',
  );
  assert.equal((await request(`/sessions/${room.sessionId}/summary`, outsider)).status, 404);
  assert.equal((await request(`/sessions/${room.sessionId}/summary`, guest)).status, 200);
  console.log(
    'PASS restart recovery without downtime credit, durable task/summary, frozen writes and exactly-once settlement',
  );

  // Deterministic statistics fixture: overlaps, touching interruptions, late join, AFK, lobby-only participant.
  const { saveRecords } = await import('../apps/server/src/modules/record.js');
  const third = await actor('stats_third');
  const origin = new Date('2026-01-01T00:00:00Z').getTime();
  const date = (s: number) => new Date(origin + s * 1000);
  const fixture = await database.room.create({
    data: {
      code: 'STAT22',
      name: '统计口径',
      owner: { connect: { id: owner.id } },
      session: { create: { focusSeconds: 10, breakSeconds: 5, phase: 'FOCUS' } },
      members: {
        create: [owner, guest, outsider, third].map((u, i) => ({ userId: u.id, seatIndex: i })),
      },
    },
  });
  await database.phaseInterval.createMany({
    data: [0, 15].map((s, i) => ({
      sessionId: fixture.sessionId,
      roundNo: i + 1,
      phase: 'FOCUS',
      startAt: date(s),
      endAt: date(s + 10),
    })),
  });
  const spans = [
    [owner.id, 0, 25],
    [owner.id, 0, 25],
    [guest.id, 2, 7],
    [guest.id, 15, 25],
    [outsider.id, 0, 4],
    [outsider.id, 4, 10],
    [third.id, 10, 15],
  ] as const;
  await database.presenceInterval.createMany({
    data: spans.map(([userId, a, b]) => ({
      sessionId: fixture.sessionId,
      userId,
      startAt: date(a),
      endAt: date(b),
    })),
  });
  await database.task.createMany({
    data: [true, false].map((completed) => ({
      sessionId: fixture.sessionId,
      userId: guest.id,
      title: 'private',
      completed,
    })),
  });
  await database.$transaction((tx) => saveRecords(tx, fixture.id));
  const records = await database.studyRecord.findMany({ where: { sessionId: fixture.sessionId } });
  const record = (userId: string) => {
    const r = records.find((r) => r.userId === userId)!;
    return [r.focusSeconds, r.roundsCompleted, r.studiedWith, r.tasksDone, r.tasksTotal];
  };
  assert.deepEqual(record(owner.id), [20, 2, 2, 0, 0]);
  assert.deepEqual(record(guest.id), [15, 1, 2, 1, 2]);
  assert.deepEqual(record(outsider.id), [10, 0, 2, 0, 0]);
  assert.deepEqual(record(third.id), [0, 0, 0, 0, 0]);
  await database.studySession.update({
    where: { id: fixture.sessionId },
    data: { phase: 'ENDED', endedAt: new Date() },
  });
  console.log(
    'PASS exact statistics: merged overlap, interrupted rounds, late/AFK seconds, distinct co-study and lobby exclusion',
  );

  const lateRoom = (await request('/rooms', owner, input('迟到与断线结算'))).data;
  await command(recoveredA, 'room:join', lateRoom.roomId);
  await command(recoveredA, 'member:ready', lateRoom.roomId, { ready: true });
  assert.equal((await command(recoveredA, 'session:start', lateRoom.roomId)).ok, true);
  await request('/rooms/join', guest, { code: lateRoom.code, requestId: crypto.randomUUID() });
  const late = await command(recoveredB, 'room:join', lateRoom.roomId);
  assert.equal(late.data?.session.phase, 'FOCUS');
  assert.equal(late.data?.members.find((m) => m.userId === guest.id)?.lateJoin, true);
  await command(recoveredB, 'task:create', lateRoom.roomId, { title: '离开再回来也保留' });
  await command(recoveredB, 'member:leave', lateRoom.roomId);
  assert.equal(
    await database.presenceInterval.count({
      where: { sessionId: lateRoom.sessionId, userId: guest.id, endAt: null },
    }),
    0,
  );
  await request('/rooms/join', guest, { code: lateRoom.code, requestId: crypto.randomUUID() });
  assert.equal((await command(recoveredB, 'room:join', lateRoom.roomId)).data?.myTasks.length, 1);
  recoveredB.disconnect();
  await waitFor(
    async () =>
      (await request(`/rooms/${lateRoom.roomId}/snapshot`, owner)).data.members.find(
        (m: { userId: string }) => m.userId === guest.id,
      )?.connectionState === 'DISCONNECTED',
    'active guest disconnected',
  );
  const finalGuest = await connect(guest);
  assert.equal(
    (await command(finalGuest, 'room:join', lateRoom.roomId)).data?.session.phase,
    'FOCUS',
  );
  recoveredA.disconnect();
  await waitFor(
    async () =>
      (await request(`/rooms/${lateRoom.roomId}/snapshot`, guest)).data.session?.phase === 'ENDED',
    'active owner timeout settlement',
  );
  const autoSummary = (await request(`/sessions/${lateRoom.sessionId}/summary`, guest)).data;
  assert.equal(autoSummary.endReason, 'OWNER_DISCONNECTED');
  assert.equal(autoSummary.record.tasksTotal, 1);
  assert.equal(autoSummary.record.roundsCompleted, 0);
  assert.equal(await database.studyRecord.count({ where: { sessionId: lateRoom.sessionId } }), 2);
  assert.equal(
    await database.presenceInterval.count({
      where: { sessionId: lateRoom.sessionId, endAt: null },
    }),
    0,
  );
  console.log(
    'PASS late joining, leave/rejoin task preservation, active reconnect and owner-timeout settlement',
  );

  await stop();
  for (const socket of sockets) socket.disconnect();
  env.DEMO_MODE = 'false';
  await boot();
  const formalRoom = (await request('/rooms', outsider, input('正常节奏权限'))).data;
  const formalSocket = await connect(outsider);
  const formal = await command(formalSocket, 'room:join', formalRoom.roomId);
  assert.equal(formal.data?.demoAvailable, false);
  assert.equal(
    (
      await command(formalSocket, 'room:configure', formalRoom.roomId, {
        focusSeconds: 45,
        breakSeconds: 15,
      })
    ).ok,
    false,
  );
  await command(formalSocket, 'session:end', formalRoom.roomId);
  assert.equal(
    (await request(`/sessions/${formalRoom.sessionId}/summary`, outsider)).data.record.focusSeconds,
    0,
  );
  await stop();
  formalSocket.disconnect();
  env.DEMO_MODE = 'true';
  await boot();
  console.log('PASS demo preset requires server opt-in, lobby settlement returns zero focus');

  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
  });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await ctxA.newPage(),
    pageB = await ctxB.newPage();
  const errors: string[] = [];
  for (const [page, name] of [
    [pageA, 'browser_session_a'],
    [pageB, 'browser_session_b'],
  ] as const) {
    page.on('pageerror', (error) => errors.push(error.message));
    await actor(name);
    await page.goto(`${base}/login`);
    await page.getByLabel('账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill('SessionStudy42!');
    await page.getByRole('button', { name: '登录 FocusSpace' }).click();
    await expect(page.getByRole('heading', { name: '创建自习房间' })).toBeVisible();
  }
  await pageA.getByLabel('房间名称', { exact: true }).fill('一起推进一点点');
  await pageA.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '使用 45/15 秒演示节奏' })).toBeEnabled();
  const code = (await pageA.locator('.invite-code strong').textContent())!;
  await pageB.getByLabel('房间码', { exact: true }).fill(code);
  await pageB.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(pageA.locator('.member-list li')).toHaveCount(2);
  await pageA.getByRole('button', { name: '使用 45/15 秒演示节奏' }).click();
  await expect(pageB.getByText('秒专注 · 演示')).toBeVisible();
  await pageB.getByLabel('新任务', { exact: true }).fill('我的秘密复习计划');
  await pageB.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：我的秘密复习计划' })).toBeVisible();
  await pageA.getByRole('button', { name: '我准备好了' }).click();
  await pageB.getByRole('button', { name: '我准备好了' }).click();
  await expect(pageA.getByRole('button', { name: '开始共学' })).toBeEnabled();
  await pageA.getByRole('button', { name: '开始共学' }).click();
  await expect(pageA.locator('.timer-FOCUS')).toBeVisible();
  await expect(pageB.locator('.timer-FOCUS')).toBeVisible();
  await expect(pageB.getByRole('button', { name: '发送消息' })).toBeHidden();
  await pageB.getByRole('checkbox', { name: '完成任务：我的秘密复习计划' }).click();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：我的秘密复习计划' })).toBeChecked();
  await expect(pageA.locator('.member-list')).toContainText('1 / 1 · 100%');
  await expect(pageA.getByText('我的秘密复习计划', { exact: true })).toHaveCount(0);
  await pageB.reload();
  await expect(pageB.locator('.timer-FOCUS')).toBeVisible();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：我的秘密复习计划' })).toBeChecked();
  // A client wall-clock change must not change the countdown's calibrated monotonic time.
  const before = await pageB.getByRole('timer').textContent();
  await pageB.evaluate(() => {
    Date.now = () => 1;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await new Promise((r) => setTimeout(r, 350));
  const after = await pageB.getByRole('timer').textContent();
  const seconds = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
  assert(Math.abs(seconds(before!) - seconds(after!)) <= 2);
  await pageA.screenshot({ path: resolve(directory, 'focus-desktop.png'), fullPage: true });
  await pageB.screenshot({ path: resolve(directory, 'focus-mobile.png'), fullPage: true });
  assert.equal(
    await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  console.log(
    'PASS two-browser start/task privacy/refresh and monotonic clock; waiting for real 45s/15s phase boundaries',
  );
  await expect(pageA.locator('.timer-BREAK')).toBeVisible({ timeout: 50000 });
  await expect(pageB.locator('.timer-BREAK')).toBeVisible();
  await pageB
    .getByLabel('休息消息', { exact: true })
    .fill('<img src=x onerror=alert(1)> 我完成了！');
  await pageB.getByRole('button', { name: '发送消息' }).click();
  await expect(pageA.getByRole('log')).toContainText('<img src=x onerror=alert(1)> 我完成了！');
  await expect(pageA.getByRole('log').locator('img')).toHaveCount(0);
  await pageA.screenshot({ path: resolve(directory, 'break-desktop.png'), fullPage: true });
  await expect(pageA.locator('.timer-FOCUS')).toBeVisible({ timeout: 20000 });
  await expect(pageA.locator('.phase-timer')).toContainText('第 2 轮');
  await expect(pageB.getByRole('button', { name: '发送消息' })).toBeHidden();
  await pageA.getByRole('button', { name: '结束共学', exact: true }).click();
  await pageA.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(pageA.getByRole('heading', { name: '这次相聚先到这里' })).toBeVisible();
  await expect(pageB.locator('.summary-metrics')).toContainText('1 / 1');
  await pageB.getByRole('link', { name: '打开已保存结果' }).click();
  await pageB.reload();
  await expect(pageB.locator('.summary-metrics')).toContainText('1 / 1');
  await pageA.screenshot({ path: resolve(directory, 'summary-desktop.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `PASS natural FOCUS → BREAK → round 2, plain-text chat, end and durable results. Artifacts: ${directory}`,
  );
} catch (error) {
  writeFileSync(resolve(directory, 'server.log'), processLog);
  for (const [i, context] of (browser?.contexts() ?? []).entries())
    await context
      .pages()[0]
      ?.screenshot({ path: resolve(directory, `failure-${i}.png`), fullPage: true })
      .catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.disconnect();
  await stop();
  await database.$disconnect();
}
