import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect as baseExpect, type Browser } from '@playwright/test';
import type { Ack, RoomSnapshot, ChatEvent } from '@focusspace/shared';

const expect = baseExpect.configure({ timeout: 15000 });
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/feedback-'));
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
  DISCONNECT_GRACE_MS: '60000',
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
  const owner = await actor('feedback_owner'),
    guest = await actor('feedback_guest'),
    outsider = await actor('feedback_outside');
  const room = (await request('/rooms', owner, input('第五阶段共学'))).data;
  const a = await connect(owner),
    b = await connect(guest);
  await command(a, 'room:join', room.roomId);
  await request('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
  let snap = (await command(b, 'room:join', room.roomId)).data!;
  assert.match(snap.myPermissions.startDisabledReason!, /房主/);
  const created = await command(b, 'task:create', room.roomId, { title: 'PRIVATE_FEEDBACK_TASK' });
  let task = created.data!.myTasks[0];
  const update = async (payload: object) => {
    const ack = await command(b, 'task:update', room.roomId, {
      taskId: task.id,
      version: task.version,
      ...payload,
    });
    assert(ack.ok, JSON.stringify(ack.error));
    task = ack.data!.myTasks[0];
    return ack.data!;
  };
  assert(
    !JSON.stringify((await request('/rooms/' + room.roomId + '/snapshot', owner)).data).includes(
      task.title,
    ),
  );
  await update({ visibility: 'PUBLIC' });
  assert(
    JSON.stringify((await request('/rooms/' + room.roomId + '/snapshot', owner)).data).includes(
      task.title,
    ),
  );
  await update({ visibility: 'PRIVATE' });
  assert(
    !JSON.stringify((await request('/rooms/' + room.roomId + '/snapshot', owner)).data).includes(
      task.title,
    ),
  );
  assert.equal((await request('/rooms/' + room.roomId + '/snapshot', outsider)).status, 404);
  await command(a, 'member:ready', room.roomId, { ready: true });
  await command(b, 'member:ready', room.roomId, { ready: true });
  assert((await command(a, 'session:start', room.roomId)).ok);
  const lights: unknown[] = [];
  a.on('room:light', (e) => lights.push(e));
  const completionId = crypto.randomUUID(),
    payload = { taskId: task.id, version: task.version, completed: true };
  assert((await command(b, 'task:update', room.roomId, payload, completionId)).ok);
  assert((await command(b, 'task:update', room.roomId, payload, completionId)).ok);
  assert.equal(lights.length, 1);
  task = (await command(b, 'room:sync', room.roomId)).data!.myTasks[0];
  assert.equal(lights.length, 1);
  assert.equal((await update({ completed: false })).feedback.roundTasksDone, 0);
  assert.equal((await update({ completed: true })).feedback.roundTasksDone, 1);
  assert.equal(lights.length, 1);
  const rid = crypto.randomUUID();
  assert((await command(a, 'reaction:send', room.roomId, { symbol: '🌱' }, rid)).ok);
  assert((await command(a, 'reaction:send', room.roomId, { symbol: '🌱' }, rid)).ok);
  assert.equal(
    (await command(a, 'reaction:send', room.roomId, { symbol: '💪' })).error?.code,
    'RATE_LIMITED',
  );
  assert.equal(lights.length, 2);
  assert.equal(
    (await command(b, 'chat:send', room.roomId, { content: 'focus blocked' })).error?.code,
    'INVALID_PHASE',
  );
  // Deterministic past spans: A=60s, B=30s, duplicate A interval and third overlap must not inflate 30s common time.
  const end = Date.now() - 1000,
    start = end - 60000;
  await database.phaseInterval.updateMany({
    where: { sessionId: room.sessionId },
    data: { startAt: new Date(start), endAt: new Date(end) },
  });
  await database.presenceInterval.deleteMany({ where: { sessionId: room.sessionId } });
  await database.presenceInterval.createMany({
    data: [
      { userId: owner.id, startAt: new Date(start), endAt: new Date(end) },
      { userId: owner.id, startAt: new Date(start + 1000), endAt: new Date(end - 1000) },
      { userId: guest.id, startAt: new Date(start + 30000), endAt: new Date(end) },
    ].map((p) => ({ ...p, sessionId: room.sessionId })),
  });
  await database.studySession.update({
    where: { id: room.sessionId },
    data: {
      phase: 'BREAK',
      phaseStartAt: new Date(end),
      phaseEndAt: new Date(Date.now() + 300000),
    },
  });
  snap = (await command(b, 'room:sync', room.roomId)).data!;
  assert.equal(snap.feedback.roundFocusSeconds, 30);
  assert.equal(snap.feedback.roomFocusSeconds, 30);
  assert.equal(snap.feedback.roundTasksDone, 1);
  const chatId = crypto.randomUUID();
  assert((await command(b, 'chat:send', room.roomId, { content: 'history_once' }, chatId)).ok);
  assert((await command(b, 'chat:send', room.roomId, { content: 'history_once' }, chatId)).ok);
  assert.equal(
    (await command(a, 'room:sync', room.roomId)).data!.recentMessages.filter(
      (m) => m.content === 'history_once',
    ).length,
    1,
  );
  assert.equal(
    (await command(b, 'chat:send', room.roomId, { content: 'too fast' })).error?.code,
    'RATE_LIMITED',
  );
  await database.chatMessage.create({
    data: {
      sessionId: room.sessionId,
      roomId: room.roomId,
      userId: guest.id,
      content: 'expired_hidden',
      createdAt: new Date(Date.now() - 90000000),
      requestId: crypto.randomUUID(),
    },
  });
  assert(
    !(await command(a, 'room:sync', room.roomId)).data!.recentMessages.some(
      (m) => m.content === 'expired_hidden',
    ),
  );
  const late = await request('/rooms/join', outsider, {
    code: room.code,
    requestId: crypto.randomUUID(),
  });
  assert.equal(late.status, 200);
  const x = await connect(outsider);
  const lateSnap = (await command(x, 'room:join', room.roomId)).data!;
  assert.equal(lateSnap.session.phase, 'BREAK');
  assert.equal(lateSnap.feedback.focusSeconds, 0);
  assert.equal(lateSnap.recentMessages.length, 1);
  await command(a, 'session:end', room.roomId);
  await command(a, 'session:end', room.roomId);
  const result = (await request('/sessions/' + room.sessionId + '/summary', guest)).data;
  assert.equal(result.record.focusSeconds, 30);
  assert.equal(result.roomFocusSeconds, 30);
  assert.equal((await request('/users/me/history', guest)).data.totals.focusSeconds, 30);
  assert.equal((await request('/users/me/history?page=0', guest)).status, 400);
  assert.equal((await request('/users/me/history')).status, 401);
  console.log(
    'PASS privacy, round and overlap statistics, late join, receipt dedup, reactions, retained chat and authorized history',
  );

  // Populate own ended records for pagination and demo exclusion without changing the daily database.
  for (let i = 0; i < 11; i++)
    await database.studySession.create({
      data: {
        phase: 'ENDED',
        focusSeconds: i === 0 ? 45 : 1500,
        breakSeconds: i === 0 ? 15 : 300,
        endedAt: new Date(),
        room: {
          create: {
            name: '分页记录 ' + i,
            code: 'PG' + String(i).padStart(4, '0'),
            ownerId: guest.id,
            members: { create: { userId: guest.id, seatIndex: 0 } },
          },
        },
        records: {
          create: {
            userId: guest.id,
            focusSeconds: 10,
            roundsCompleted: 0,
            tasksDone: 1,
            tasksTotal: 2,
            studiedWith: 0,
          },
        },
      },
    });
  const history = (await request('/users/me/history', guest)).data;
  assert.equal(history.total, 12);
  assert.equal(history.items.length, 10);
  assert.equal(history.demoSessions, 1);
  assert.equal(history.totals.focusSeconds, 130);
  assert.equal((await request('/users/me/history?page=2', guest)).data.items.length, 2);
  assert.equal(
    (await request('/sessions/' + history.items[0].sessionId + '/summary', owner)).status,
    404,
  );
  const { commonSeconds } = await import('../apps/server/src/modules/record.js');
  assert.equal(
    commonSeconds([
      [
        [0, 10000],
        [1000, 5000],
      ],
      [[5000, 15000]],
      [[7000, 9000]],
    ]),
    5,
  );
  const { mergeMessages } = await import('../apps/web/src/state/messages.js');
  const msg = { id: 'b', userId: guest.id, nickname: 'guest', content: 'x', createdAt: Date.now() };
  assert.deepEqual(
    mergeMessages([msg], [{ ...msg, id: 'a' }, msg], Date.now()).map((m) => m.id),
    ['a', 'b'],
  );
  console.log(
    'PASS pagination, demo exclusion, summary ownership, three-user sweep and equal-time message ordering',
  );

  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
  });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await ctxA.newPage(),
    pageB = await ctxB.newPage();
  const errors: string[] = [];
  for (const [ctx, who] of [
    [ctxA, owner],
    [ctxB, guest],
  ] as const) {
    const [name, ...value] = who.cookie.split('=');
    await ctx.addCookies([{ name, value: value.join('='), url: base }]);
  }
  for (const page of [pageA, pageB]) page.on('pageerror', (e) => errors.push(e.message));
  await pageA.goto(base);
  await expect(pageA.getByRole('heading', { name: '最近共学' })).toBeVisible();
  await pageA
    .getByRole('button', { name: '50 / 10', exact: false })
    .count()
    .then(async (n) => {
      if (n) await pageA.getByRole('button', { name: '50 / 10', exact: false }).click();
    });
  await pageA.locator('.preference-details summary').click();
  await pageA.getByRole('button', { name: '保存为默认节奏' }).click();
  await pageA.reload();
  await pageA
    .locator('.create-panel')
    .getByLabel('房间名称', { exact: true })
    .fill('浏览器反馈验证');
  await pageA.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '开始共学' })).toBeDisabled();
  await expect(pageA.getByText('请所有成员（含房主）先准备')).toBeVisible();
  const browserCode = (await pageA.locator('.invite-code strong').textContent())!,
    roomUrl = pageA.url();
  const roomId = roomUrl.split('/').at(-1)!;
  const browserRoom = await database.room.findUniqueOrThrow({ where: { id: roomId } });
  // Force a real configuration write failure: editor must stay open with its draft.
  await database.$executeRawUnsafe(
    `CREATE TRIGGER fail_feedback_rhythm BEFORE UPDATE OF focusSeconds ON StudySession WHEN OLD.id='${browserRoom.sessionId}' BEGIN SELECT RAISE(ABORT,'verification failure'); END`,
  );
  await pageA.locator('.rhythm-panel').getByRole('button', { name: '修改', exact: true }).click();
  await pageA.getByRole('button', { name: '保存节奏', exact: true }).click();
  await expect(pageA.locator('.notice')).toBeVisible();
  await expect(pageA.getByRole('button', { name: '保存节奏', exact: true })).toBeEnabled();
  await database.$executeRawUnsafe('DROP TRIGGER fail_feedback_rhythm');
  await pageA.getByRole('button', { name: '保存节奏', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '保存节奏', exact: true })).toHaveCount(0);
  await pageA.getByLabel('新任务', { exact: true }).fill('owner_draft');
  await pageA.reload();
  await expect(pageA.getByLabel('新任务', { exact: true })).toHaveValue('owner_draft');
  await pageA.getByRole('button', { name: '使用座位卡片' }).click();
  await pageA.getByLabel('环境音音量').fill('17');
  await pageA.reload();
  await expect(pageA.getByRole('button', { name: '打开 3D 空间' })).toBeVisible();
  await expect(pageA.getByLabel('环境音音量')).toHaveValue('17');
  assert(await pageA.locator('audio').evaluate((e: HTMLAudioElement) => e.paused));
  await pageA.getByRole('button', { name: '添加任务', exact: true }).click();
  await pageA.getByRole('button', { name: '删除任务：owner_draft', exact: true }).click();
  await pageA.getByRole('button', { name: '保留任务' }).click();
  await expect(pageA.getByRole('checkbox', { name: '完成任务：owner_draft' })).toBeVisible();
  await pageB.goto(base + '/join/' + browserCode);
  await pageB.getByRole('button', { name: '加入邀请房间' }).click();
  await expect(pageB.getByLabel('新任务', { exact: true })).toHaveValue('');
  await pageB.getByRole('button', { name: '使用座位卡片' }).click();
  await pageA.getByRole('button', { name: '公开任务：owner_draft' }).click();
  await expect(pageB.locator('.public-task')).toContainText('owner_draft');
  await pageA.getByRole('button', { name: '设为私有：owner_draft' }).click();
  await expect(pageB.locator('.public-task')).toHaveCount(0);
  await pageA.getByRole('button', { name: '我准备好了' }).click();
  await pageB.getByRole('button', { name: '我准备好了' }).click();
  await pageA.getByRole('button', { name: '开始共学' }).click();
  await expect(pageB.locator('.timer-FOCUS')).toBeVisible();
  // Shift only this test session into Break to avoid waiting for a real study interval.
  await database.studySession.update({
    where: { id: browserRoom.sessionId },
    data: { phaseEndAt: new Date(Date.now() - 100) },
  });
  await pageA.getByRole('button', { name: '发送鼓励 🌱' }).click();
  await expect(pageB.locator('.timer-BREAK')).toBeVisible();
  await database.chatMessage.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      roomId,
      sessionId: browserRoom.sessionId,
      userId: guest.id,
      content: '历史消息 ' + i,
      requestId: crypto.randomUUID(),
      createdAt: new Date(Date.now() - 10000 + i),
    })),
  });
  await pageB.reload();
  await expect(pageB.getByRole('log').locator('article')).toHaveCount(20);
  await pageB.getByLabel('休息消息', { exact: true }).fill('chat_draft');
  await pageB.reload();
  await expect(pageB.getByLabel('休息消息', { exact: true })).toHaveValue('chat_draft');
  await pageB.getByRole('log').evaluate((e) => {
    e.scrollTop = 0;
    e.dispatchEvent(new Event('scroll'));
  });
  await database.$executeRawUnsafe(
    "CREATE TRIGGER fail_feedback_chat BEFORE INSERT ON ChatMessage BEGIN SELECT RAISE(ABORT,'verification failure'); END",
  );
  await pageA.getByLabel('休息消息', { exact: true }).fill('实时消息');
  await pageA.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '重试发送', exact: true })).toBeVisible();
  await expect(pageA.getByLabel('休息消息', { exact: true })).toHaveValue('实时消息');
  assert.equal(await database.chatMessage.count({ where: { roomId, content: '实时消息' } }), 0);
  await database.$executeRawUnsafe('DROP TRIGGER fail_feedback_chat');
  await pageA.getByRole('button', { name: '重试发送', exact: true }).click();
  await expect(pageB.getByRole('button', { name: '有新消息 · 回到最新' })).toBeVisible();
  assert.equal(await pageB.getByRole('log').evaluate((e) => e.scrollTop), 0);
  await pageB.reload();
  await expect(pageB.getByRole('log').locator('article')).toHaveCount(21);
  await expect(pageB.getByRole('log').getByText('实时消息', { exact: true })).toHaveCount(1);
  await pageB.screenshot({ path: resolve(directory, 'break-mobile.png'), fullPage: true });
  await pageA.screenshot({ path: resolve(directory, 'break-desktop.png'), fullPage: true });
  assert.equal(
    await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await ctxB.setOffline(true);
  await expect(pageB.getByRole('button', { name: '发送消息', exact: true })).toBeDisabled({
    timeout: 30000,
  });
  await ctxB.setOffline(false);
  await expect(pageB.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled({
    timeout: 15000,
  });
  assert.equal(await database.chatMessage.count({ where: { content: 'chat_draft' } }), 0);
  await pageB.getByRole('button', { name: '退出登录', exact: true }).click();
  await pageB.getByRole('button', { name: '确认退出登录', exact: true }).click();
  await expect(pageB.getByRole('button', { name: '登录 FocusSpace' })).toBeVisible();
  assert.equal(
    await pageB.evaluate(
      () => Object.keys(sessionStorage).filter((k) => k.startsWith('focusspace:draft:')).length,
    ),
    0,
  );
  await pageB.goto(base + '/join/' + browserCode);
  await pageB.getByLabel('账号', { exact: true }).fill(guest.username);
  await pageB.getByLabel('密码', { exact: true }).fill('SessionStudy42!');
  await pageB.getByRole('button', { name: '登录 FocusSpace' }).click();
  await expect(pageB.getByRole('button', { name: '加入邀请房间' })).toBeVisible();
  await pageB.getByRole('button', { name: '加入邀请房间' }).click();
  await expect(pageB.getByLabel('休息消息', { exact: true })).toHaveValue('');
  await pageA.getByRole('button', { name: '结束共学', exact: true }).click();
  await pageA.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(pageA.getByRole('heading', { name: '这次相聚先到这里' })).toBeVisible();
  await pageB.goto(base + '/history');
  await expect(pageB.getByRole('button', { name: '下一页' })).toBeVisible();
  await pageB.getByRole('button', { name: '下一页' }).click();
  await expect(pageB.getByText('第 2 / 2 页')).toBeVisible();
  await pageB.screenshot({ path: resolve(directory, 'history-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(directory, 'result.json'),
    JSON.stringify({ passed: true, base, directory }, null, 2),
  );
  console.log(
    'PASS browser drafts, preferences, no autoplay, save failure, delete protection, public title removal, invite login, history, chat scroll/recovery, offline no auto-send and logout clearing. ' +
      directory,
  );
} catch (error) {
  writeFileSync(resolve(directory, 'server.log'), processLog);
  for (const [i, ctx] of (browser?.contexts() ?? []).entries())
    await ctx
      .pages()[0]
      ?.screenshot({ path: resolve(directory, 'failure-' + i + '.png'), fullPage: true })
      .catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.disconnect();
  await stop();
  await database.$disconnect();
}
