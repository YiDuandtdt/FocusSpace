import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Browser } from '@playwright/test';
import type { Ack, RoomSnapshot, ChatEvent } from '@focusspace/shared';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/delivery-'));
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
  DISCONNECT_GRACE_MS: '8000',
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
};
// Build the previous schema from its actual committed migrations, then upgrade it.
const legacy = resolve(directory, 'legacy');
mkdirSync(resolve(legacy, 'migrations'), { recursive: true });
writeFileSync(resolve(legacy, 'schema.prisma'), readFileSync('prisma/schema.prisma'));
for (const name of ['202609070001_init', '202609070002_sessions'])
  cpSync(resolve('prisma/migrations', name), resolve(legacy, 'migrations', name), {
    recursive: true,
  });
cpSync('prisma/migrations/migration_lock.toml', resolve(legacy, 'migrations/migration_lock.toml'));
const oldMigration = spawnSync(
  process.execPath,
  [
    'node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--schema',
    resolve(legacy, 'schema.prisma'),
  ],
  { env, encoding: 'utf8', windowsHide: true },
);
assert.equal(oldMigration.status, 0, oldMigration.stdout + oldMigration.stderr);
await database.user.create({
  data: {
    username: 'upgrade_retained',
    nickname: '保留旧账号',
    passwordHash: 'unusable-test-hash',
  },
});
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
  server = spawn(process.execPath, ['--env-file=.env', 'scripts/start.mjs'], {
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
  if (server && server.exitCode === null && server.signalCode === null) {
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
  const seed = spawnSync(process.execPath, ['--env-file=.env', 'scripts/init-demo.mjs'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(seed.status, 0, seed.stderr);
  const seeded = await database.user.findMany({ orderBy: { username: 'asc' } });
  assert.equal(seeded.length, 4);
  assert(
    seeded.every(
      (user) => user.role === 'USER' && ['lake', 'sage', 'lilac'].includes(user.avatarId),
    ),
  );
  const again = spawnSync(process.execPath, ['--env-file=.env', 'scripts/init-demo.mjs'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(again.status, 0, again.stderr);
  const migrateAgain = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(migrateAgain.status, 0, migrateAgain.stderr);
  assert.deepEqual(await database.user.findMany({ orderBy: { username: 'asc' } }), seeded);
  console.log(
    'PASS explicit demo seed and repeated migration preserve accounts and password hashes',
  );
  await boot();
  const owner = await actor('recovery_owner'),
    guest = await actor('recovery_guest');
  const room = (await request('/rooms', owner, input('重启恢复验证'))).data;
  let a = await connect(owner),
    b = await connect(guest);
  await command(a, 'room:join', room.roomId);
  await request('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
  await command(b, 'room:join', room.roomId);
  await command(a, 'room:configure', room.roomId, { focusSeconds: 45, breakSeconds: 15 });
  await command(a, 'member:ready', room.roomId, { ready: true });
  await command(b, 'member:ready', room.roomId, { ready: true });
  assert((await command(a, 'session:start', room.roomId)).ok);
  // Kill only this test process. Place a deterministic one-day outage on its isolated timeline.
  await stop();
  a.disconnect();
  b.disconnect();
  const startAt = new Date(Date.now() - 86465000),
    lastSeenAt = new Date(startAt.getTime() + 5000);
  await database.studySession.update({
    where: { id: room.sessionId },
    data: {
      phase: 'FOCUS',
      roundNo: 1,
      startedAt: startAt,
      phaseStartAt: startAt,
      phaseEndAt: new Date(startAt.getTime() + 45000),
    },
  });
  await database.phaseInterval.updateMany({
    where: { sessionId: room.sessionId },
    data: { startAt, endAt: null },
  });
  await database.presenceInterval.updateMany({
    where: { sessionId: room.sessionId },
    data: { startAt, endAt: null },
  });
  await database.roomMember.updateMany({
    where: { roomId: room.roomId },
    data: { connectionState: 'CONNECTED', lastSeenAt, reconnectDeadlineAt: null },
  });
  await boot();
  let snap = (await request(`/rooms/${room.roomId}/snapshot`, owner)).data as RoomSnapshot;
  assert(snap.members.every((member) => member.connectionState === 'DISCONNECTED'));
  assert.equal(snap.session.phase, 'FOCUS');
  assert.equal(snap.session.roundNo, 1442);
  assert.equal(snap.session.phaseStartAt, startAt.getTime() + 86460000);
  const closed = await database.presenceInterval.findMany({ where: { sessionId: room.sessionId } });
  assert(closed.every((interval) => interval.endAt?.getTime() === lastSeenAt.getTime()));
  const deadline = (
    await database.roomMember.findFirstOrThrow({ where: { roomId: room.roomId, userId: owner.id } })
  ).reconnectDeadlineAt!;
  await stop();
  await boot();
  assert.equal(
    (
      await database.roomMember.findFirstOrThrow({
        where: { roomId: room.roomId, userId: owner.id },
      })
    ).reconnectDeadlineAt?.getTime(),
    deadline.getTime(),
  );
  a = await connect(owner);
  b = await connect(guest);
  assert((await command(a, 'room:join', room.roomId)).ok);
  assert((await command(b, 'room:join', room.roomId)).ok);
  assert((await command(a, 'session:end', room.roomId)).ok);
  assert((await command(a, 'session:end', room.roomId)).ok);
  const records = await database.studyRecord.findMany({ where: { sessionId: room.sessionId } });
  assert.equal(records.length, 2);
  assert(
    records.every(
      (record) =>
        record.focusSeconds >= 5 && record.focusSeconds < 12 && record.roundsCompleted === 0,
    ),
  );
  console.log(
    'PASS crash recovery: offline reconfirmation, unchanged phase timeline, persisted grace, no downtime credit, one settlement',
  );

  const timeoutRoom = (await request('/rooms', owner, input('断线写入补偿'))).data;
  await command(a, 'room:join', timeoutRoom.roomId);
  await command(a, 'member:ready', timeoutRoom.roomId, { ready: true });
  await command(a, 'session:start', timeoutRoom.roomId);
  await database.$executeRawUnsafe(`CREATE TRIGGER delivery_fail_disconnect BEFORE UPDATE OF connectionState ON RoomMember
    WHEN NEW.connectionState = 'DISCONNECTED' AND OLD.connectionState = 'CONNECTED'
    BEGIN SELECT RAISE(FAIL, 'delivery injected disconnect failure'); END`);
  a.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(
    (await database.roomMember.findFirstOrThrow({ where: { roomId: timeoutRoom.roomId } }))
      .connectionState,
    'CONNECTED',
  );
  await database.$executeRawUnsafe('DROP TRIGGER delivery_fail_disconnect');
  await waitFor(
    async () =>
      (await database.roomMember.findFirstOrThrow({ where: { roomId: timeoutRoom.roomId } }))
        .connectionState === 'DISCONNECTED',
    'failed disconnect retried',
  );
  const timeoutDeadline = (
    await database.roomMember.findFirstOrThrow({ where: { roomId: timeoutRoom.roomId } })
  ).reconnectDeadlineAt!;
  await stop();
  await boot();
  assert.equal(
    (
      await database.roomMember.findFirstOrThrow({ where: { roomId: timeoutRoom.roomId } })
    ).reconnectDeadlineAt?.getTime(),
    timeoutDeadline.getTime(),
  );
  await waitFor(
    async () =>
      (await database.studySession.findUniqueOrThrow({ where: { id: timeoutRoom.sessionId } }))
        .phase === 'ENDED',
    'owner grace timeout after restart',
    12000,
  );
  const ended = await database.studySession.findUniqueOrThrow({
    where: { id: timeoutRoom.sessionId },
  });
  assert.equal(ended.endedAt?.getTime(), timeoutDeadline.getTime());
  assert.equal(ended.endReason, 'OWNER_DISCONNECTED');
  assert.equal(
    await database.studyRecord.count({ where: { sessionId: timeoutRoom.sessionId } }),
    1,
  );
  console.log(
    'PASS database disconnect-write compensation and deadline-based owner timeout across restart',
  );

  // Run the production entry point with two independent real browser contexts.
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
  });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await ctxA.newPage(),
    pageB = await ctxB.newPage();
  let ambiguousTaskAck = false;
  let interceptedAck = false;
  await pageB.routeWebSocket(/\/socket.io\//, (downstream) => {
    const upstream = downstream.connectToServer();
    let ackId: string | undefined;
    downstream.onMessage((message) => {
      const text = String(message);
      const match = /^42(\d+)\["task:create",/.exec(text);
      if (ambiguousTaskAck && match) {
        ackId = match[1];
        ambiguousTaskAck = false;
      }
      upstream.send(message);
    });
    upstream.onMessage((message) => {
      const text = String(message);
      if (ackId && text.startsWith('43' + ackId + '[')) {
        const ack = JSON.parse(text.slice(('43' + ackId).length))[0];
        assert(ack.ok, 'Injected failure must follow a real committed task');
        downstream.send(
          '43' +
            ackId +
            JSON.stringify([
              {
                requestId: ack.requestId,
                ok: false,
                error: { code: 'DATABASE_UNAVAILABLE', message: '保存确认中断，请核对后重试' },
              },
            ]),
        );
        interceptedAck = true;
        ackId = undefined;
      } else downstream.send(message);
    });
  });
  const errors: string[] = [];
  const failedResources: string[] = [];
  for (const [page, name] of [
    [pageA, 'delivery_a'],
    [pageB, 'delivery_b'],
  ] as const) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/assets/') && !response.ok())
        failedResources.push(response.url());
    });
    await actor(name);
    await page.goto(`${base}/login`);
    await page.getByLabel('账号', { exact: true }).fill(name);
    await page.getByLabel('密码', { exact: true }).fill('SessionStudy42!');
    await page.getByRole('button', { name: '登录 FocusSpace' }).click();
    await expect(page.getByRole('heading', { name: '创建自习房间' })).toBeVisible();
  }
  await pageA.getByLabel('房间名称', { exact: true }).fill('交付演示自习室');
  await pageA.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '使用 45/15 秒演示节奏' })).toBeEnabled();
  const roomUrl = pageA.url();
  const code = (await pageA.locator('.invite-code strong').textContent())!;
  await pageB.getByLabel('房间码', { exact: true }).fill(code);
  await pageB.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(pageA.locator('.member-list li')).toHaveCount(2);
  await pageA.getByRole('button', { name: '使用 45/15 秒演示节奏' }).click();
  await expect(pageB.getByText('秒专注 · 演示')).toBeVisible();
  await expect(pageA.locator('.scene-host canvas')).toBeVisible();
  await pageA.getByRole('button', { name: '播放雨声', exact: true }).click();
  await expect
    .poll(() => pageA.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.2);
  await pageA.getByRole('button', { name: '暂停雨声', exact: true }).click();
  assert.equal((await fetch(`${base}/audio/missing.wav`)).status, 404);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);

  await database.$executeRawUnsafe(
    `CREATE TRIGGER delivery_fail_task BEFORE INSERT ON Task BEGIN SELECT RAISE(FAIL, 'delivery injected task failure'); END`,
  );
  await pageB.getByLabel('新任务', { exact: true }).fill('完成交付验证');
  await pageB.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(pageB.getByRole('alert')).toContainText('数据暂时无法保存或读取');
  await expect(pageB.getByLabel('新任务', { exact: true })).toHaveValue('完成交付验证');
  assert.equal(await database.task.count({ where: { title: '完成交付验证' } }), 0);
  await database.$executeRawUnsafe('DROP TRIGGER delivery_fail_task');
  ambiguousTaskAck = true;
  await pageB.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：完成交付验证' })).toBeVisible();
  await expect(pageB.getByRole('alert')).toContainText('保存确认中断');
  assert(interceptedAck);
  await expect(pageB.getByLabel('新任务', { exact: true })).toHaveValue('完成交付验证');
  await pageB.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(pageB.getByLabel('新任务', { exact: true })).toHaveValue('');
  assert.equal(await database.task.count({ where: { title: '完成交付验证' } }), 1);
  await pageA.getByRole('button', { name: '我准备好了' }).click();
  await pageB.getByRole('button', { name: '我准备好了' }).click();
  await expect(pageA.getByRole('button', { name: '开始共学' })).toBeEnabled();
  await pageA.getByRole('button', { name: '开始共学' }).click();
  await expect(pageA.locator('.timer-FOCUS')).toBeVisible();
  await expect(pageB.locator('.timer-FOCUS')).toBeVisible();
  await expect(pageB.getByRole('button', { name: '发送消息' })).toBeHidden();
  await pageB.getByRole('checkbox', { name: '完成任务：完成交付验证' }).click();
  await expect(pageA.locator('.member-list')).toContainText('1 / 1 · 100%');
  const initial = await pageB.evaluate(
    async () => (await (await fetch(`/api${location.pathname}/snapshot`)).json()).session,
  );
  await pageB.unrouteAll({ behavior: 'wait' });
  await ctxB.setOffline(true);
  await expect(pageB.getByRole('button', { name: '暂时离开', exact: true })).toBeDisabled({
    timeout: 4000,
  });
  await ctxB.setOffline(false);
  await pageB.getByRole('button', { name: '重试连接', exact: true }).click();
  await expect(pageB.getByRole('button', { name: '暂时离开', exact: true })).toBeEnabled();
  await pageB.reload();
  await expect(pageB.locator('.timer-FOCUS')).toBeVisible();
  const refreshed = await pageB.evaluate(
    async () => (await (await fetch(`/api${location.pathname}/snapshot`)).json()).session,
  );
  assert.equal(refreshed.phaseEndAt, initial.phaseEndAt);
  // Re-login returns to a room URL; this also exercises auth revocation and resubscription.
  await ctxB.clearCookies();
  await pageB.goto(roomUrl);
  await expect(pageB).toHaveURL(/\/login\?next=/);
  await pageB.getByLabel('账号', { exact: true }).fill('delivery_b');
  await pageB.getByLabel('密码', { exact: true }).fill('SessionStudy42!');
  await pageB.getByRole('button', { name: '登录 FocusSpace' }).click();
  await expect(pageB).toHaveURL(roomUrl);
  await expect(pageB.getByRole('button', { name: '暂时离开', exact: true })).toBeEnabled();
  await pageA.screenshot({ path: resolve(directory, 'production-focus.png'), fullPage: true });
  console.log(
    'PASS production assets/3D/audio, real task write failure and draft retry, two-browser sync/offline/re-login; waiting for 45/15 boundaries',
  );
  await expect(pageA.locator('.timer-BREAK')).toBeVisible({ timeout: 50000 });
  await expect(pageB.locator('.timer-BREAK')).toBeVisible();
  await pageB.getByLabel('休息消息', { exact: true }).fill('这轮任务完成了');
  await pageB.getByRole('button', { name: '发送消息' }).click();
  await expect(pageA.getByRole('log')).toContainText('这轮任务完成了');
  await expect(pageA.locator('.timer-FOCUS')).toBeVisible({ timeout: 20000 });
  await expect(pageA.locator('.phase-timer')).toContainText('第 2 轮');
  await pageA.getByRole('button', { name: '结束共学', exact: true }).click();
  await pageA.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(pageA.getByRole('heading', { name: '这次相聚先到这里' })).toBeVisible();
  await pageB.getByRole('link', { name: '打开已保存结果' }).click();
  await expect(pageB.locator('.summary-metrics')).toContainText('1 / 1');
  const summaryUrl = pageB.url();
  await ctxB.clearCookies();
  await pageB.reload();
  await pageB.getByLabel('账号', { exact: true }).fill('delivery_b');
  await pageB.getByLabel('密码', { exact: true }).fill('SessionStudy42!');
  await pageB.getByRole('button', { name: '登录 FocusSpace' }).click();
  await expect(pageB).toHaveURL(summaryUrl);
  await expect(pageB.locator('.summary-metrics')).toContainText('1 / 1');
  await pageB.route('**/api/sessions/*/summary', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: '读取暂时失败' } }),
    }),
  );
  await pageB.reload();
  await expect(pageB.getByRole('button', { name: '重新读取结果' })).toBeVisible();
  await pageB.unroute('**/api/sessions/*/summary');
  await pageB.getByRole('button', { name: '重新读取结果' }).click();
  await expect(pageB.locator('.summary-metrics')).toContainText('1 / 1');
  await pageB.screenshot({
    path: resolve(directory, 'production-summary-mobile.png'),
    fullPage: true,
  });
  await pageB.getByRole('link', { name: '← 我的空间', exact: true }).click();
  await expect(pageB.getByRole('button', { name: '创建房间', exact: true })).toBeEnabled();
  await pageB.getByLabel('房间名称', { exact: true }).fill('下一次共学');
  await pageB.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(pageB.getByRole('button', { name: '我准备好了' })).toBeEnabled();
  const newCode = (await pageB.locator('.invite-code strong').textContent())!;
  await pageA.goto(base);
  await pageA.getByLabel('房间码', { exact: true }).fill(newCode);
  await pageA.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '离开房间', exact: true })).toBeEnabled();
  await pageA.getByRole('button', { name: '离开房间', exact: true }).click();
  await pageA.getByRole('button', { name: '确认离开', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '加入房间', exact: true })).toBeEnabled();
  await pageA.getByLabel('房间码', { exact: true }).fill(newCode);
  await pageA.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '我准备好了' })).toBeEnabled();
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResources, []);
  console.log(
    'PASS natural Focus/Break/round 2, chat, saved Summary and login return/retry, new room and leave/rejoin navigation',
  );
  await browser.close();
  browser = undefined;
  await stop();

  const { retainData } = await import('../apps/server/src/modules/retention');
  const { db } = await import('../apps/server/src/db');
  const oldMessage = await database.chatMessage.findFirstOrThrow();
  const expiredAt = new Date(Date.now() - 2 * 86400000);
  await database.chatMessage.update({
    where: { id: oldMessage.id },
    data: { createdAt: expiredAt },
  });
  await database.commandReceipt.updateMany({
    where: { userId: oldMessage.userId, requestId: oldMessage.requestId },
    data: { createdAt: expiredAt },
  });
  const activeRoom = await database.room.findFirstOrThrow({
    where: { session: { phase: { not: 'ENDED' } } },
  });
  await database.commandReceipt.updateMany({
    where: { roomId: activeRoom.id },
    data: { createdAt: new Date(Date.now() - 10 * 86400000) },
  });
  const activeReceipts = await database.commandReceipt.count({ where: { roomId: activeRoom.id } });
  await retainData();
  assert.equal(await database.chatMessage.count({ where: { id: oldMessage.id } }), 0);
  const tombstone = await database.commandReceipt.findUniqueOrThrow({
    where: { userId_requestId: { userId: oldMessage.userId, requestId: oldMessage.requestId } },
  });
  assert.deepEqual(JSON.parse(tombstone.result), { expired: true });
  assert.equal(
    await database.commandReceipt.count({ where: { roomId: activeRoom.id } }),
    activeReceipts,
  );
  await db.$disconnect();
  const backupPath = resolve(directory, 'backup.db');
  const backup = spawnSync(
    process.execPath,
    ['--env-file=.env', 'scripts/backup-db.mjs', backupPath],
    { env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(backup.status, 0, backup.stderr);
  const restored = new PrismaClient({ datasourceUrl: `file:${backupPath.replaceAll('\\', '/')}` });
  assert.deepEqual(await restored.$queryRawUnsafe('PRAGMA quick_check'), [{ quick_check: 'ok' }]);
  assert.equal(await restored.user.count(), await database.user.count());
  assert.equal(await restored.studyRecord.count(), await database.studyRecord.count());
  await restored.$disconnect();
  console.log(`PASS retention and standalone backup restore. Artifacts: ${directory}`);
  writeFileSync(
    resolve(directory, 'result.json'),
    JSON.stringify(
      {
        status: 'passed',
        base,
        databaseUrl,
        checks: [
          'production-two-browser-flow',
          'restart-and-timeout',
          'database-write-recovery',
          'navigation',
          'retention',
          'backup-restore',
        ],
      },
      null,
      2,
    ),
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
