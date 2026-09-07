import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Page, type Browser } from '@playwright/test';
import type { Ack, RoomSnapshot, RoomEvent } from '@focusspace/shared';

// An isolated database and server: the developer's accounts and rooms are untouched.
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/flow-'));
const databaseUrl = `file:${resolve(directory, 'verify.db').replaceAll('\\', '/')}`;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
await database.$connect();
await database.$disconnect();
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((done) => listener.close(() => done()));
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PORT: String(port),
  HOST: '127.0.0.1',
  APP_ORIGINS: base,
  DISCONNECT_GRACE_MS: '3000',
  COOKIE_SECURE: 'false',
};
const migration = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { env, encoding: 'utf8', windowsHide: true },
);
assert.equal(migration.status, 0, migration.stderr + migration.stdout);
let processLog = '';
let server: ChildProcess;
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
  server.stdout?.on('data', (chunk) => {
    processLog += chunk.toString();
  });
  server.stderr?.on('data', (chunk) => {
    processLog += chunk.toString();
  });
  await waitFor(
    async () =>
      fetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false),
    'server ready',
  );
}
async function stop() {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
}
type Actor = { cookie: string; id: string; username: string };
async function request(
  path: string,
  actor?: Actor,
  body?: unknown,
  method = body ? 'POST' : 'GET',
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: base,
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { response, data };
}
async function actor(username: string): Promise<Actor> {
  const password = 'StudyTogether!42';
  const registered = await request('/auth/register', undefined, {
    username,
    password,
    nickname: username,
    avatarId: 'lake',
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
  assert.equal('passwordHash' in registered.data.user, false);
  const signed = await request('/auth/login', undefined, { username, password });
  assert.equal(signed.response.status, 200);
  const cookie = signed.response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  return { cookie: cookie.split(';')[0], id: signed.data.user.id, username };
}
function connect(actor: Actor) {
  const socket = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: actor.cookie, Origin: base },
    reconnection: false,
  });
  sockets.push(socket);
  const ready = new Promise<Socket>((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  socket.connect();
  return ready;
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
      .timeout(6000)
      .emit(type, { roomId, payload, requestId }, (error: Error | null, ack: Ack) =>
        error ? reject(error) : resolve(ack),
      ),
  );
}
const createInput = (name: string) => ({
  name,
  focusSeconds: 1500,
  breakSeconds: 300,
  requestId: crypto.randomUUID(),
});
try {
  await boot();
  const owner = await actor('owner');
  const guest = await actor('guest');
  const outsider = await actor('outsider');
  const extra = [] as Actor[];
  for (let i = 0; i < 7; i++) extra.push(await actor(`seat_${i}`));
  assert.equal(
    (
      await request('/auth/login', undefined, {
        username: owner.username,
        password: 'WrongPass123',
      })
    ).response.status,
    401,
  );
  assert.equal((await request('/auth/me')).response.status, 401);
  const badOrigin = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: {
      Origin: 'https://untrusted.example',
      Cookie: owner.cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createInput('No')),
  });
  assert.equal(badOrigin.status, 403);
  console.log('PASS registration, password login, HttpOnly session and Origin checks');

  const input = createInput('同步验证房间');
  const created = await request('/rooms', owner, input);
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const room = created.data as { roomId: string; code: string; sessionId: string };
  const ownerSocket = await connect(owner);
  assert.equal((await command(ownerSocket, 'room:join', room.roomId)).ok, true);
  let latest: RoomSnapshot | undefined;
  ownerSocket.on('room:snapshot', (event: RoomEvent) => {
    latest = event.data;
  });
  const retry = await request('/rooms', owner, input);
  assert.deepEqual(retry.data, room);
  assert.equal(
    (await request('/rooms', owner, { ...input, name: 'changed' })).data.error.code,
    'CONFLICT',
  );
  const otherInput = createInput('另一间房');
  const other = (await request('/rooms', outsider, otherInput)).data;
  const outsiderSocket = await connect(outsider);
  await command(outsiderSocket, 'room:join', other.roomId);
  assert.equal((await request(`/rooms/${room.roomId}/snapshot`, outsider)).response.status, 404);
  assert.equal(
    (await command(outsiderSocket, 'room:join', room.roomId)).error?.code,
    'ROOM_NOT_FOUND',
  );
  const joinInput = { code: room.code.toLowerCase(), requestId: crypto.randomUUID() };
  assert.equal((await request('/rooms/join', guest, joinInput)).response.status, 200);
  assert.equal((await request('/rooms/join', guest, joinInput)).response.status, 200);
  const guestSocket = await connect(guest);
  await command(guestSocket, 'room:join', room.roomId);
  await waitFor(
    () =>
      latest?.members.length === 2 &&
      latest.members.every((m) => m.connectionState === 'CONNECTED'),
    'member joined broadcast',
  );
  assert.equal(new Set(latest!.members.map((m) => m.seatIndex)).size, 2);
  assert.equal(
    (await request('/rooms/join', guest, { code: other.code, requestId: crypto.randomUUID() })).data
      .error.code,
    'ALREADY_IN_ROOM',
  );
  console.log('PASS atomic room creation, idempotency, private membership and unique seats');

  assert.equal(
    (
      await command(guestSocket, 'room:configure', room.roomId, {
        focusSeconds: 3000,
        breakSeconds: 600,
      })
    ).error?.code,
    'FORBIDDEN',
  );
  const readyId = crypto.randomUUID();
  assert.equal(
    (await command(guestSocket, 'member:ready', room.roomId, { ready: true }, readyId)).ok,
    true,
  );
  const readyRevision = (await request(`/rooms/${room.roomId}/snapshot`, owner)).data.revision;
  await command(guestSocket, 'member:ready', room.roomId, { ready: true }, readyId);
  assert.equal(
    (await request(`/rooms/${room.roomId}/snapshot`, owner)).data.revision,
    readyRevision,
  );
  await waitFor(
    () => latest?.members.find((m) => m.userId === guest.id)?.ready === true,
    'ready broadcast',
  );
  await command(guestSocket, 'member:afk', room.roomId, { afk: true });
  await waitFor(
    () => latest?.members.find((m) => m.userId === guest.id)?.status === 'AFK',
    'AFK broadcast',
  );
  await command(ownerSocket, 'room:configure', room.roomId, {
    focusSeconds: 3000,
    breakSeconds: 600,
  });
  await waitFor(
    () => latest?.session.focusSeconds === 3000 && latest.members.every((m) => !m.ready),
    'configuration reset',
  );
  const profile = await request(
    '/users/me',
    guest,
    { nickname: '学习搭子', avatarId: 'sage' },
    'PATCH',
  );
  assert.equal(profile.response.status, 200);
  await waitFor(
    () => latest?.members.some((m) => m.nickname === '学习搭子' && m.avatarId === 'sage') === true,
    'profile broadcast',
  );
  console.log('PASS ready, AFK, nickname/avatar, owner permission and rhythm broadcast');

  const anotherTab = await connect(guest);
  await command(anotherTab, 'room:join', room.roomId);
  guestSocket.disconnect();
  assert.equal((await command(anotherTab, 'room:sync', room.roomId)).data?.members.length, 2);
  assert.equal(
    (await request(`/rooms/${room.roomId}/snapshot`, owner)).data.members.find(
      (m: { userId: string }) => m.userId === guest.id,
    ).connectionState,
    'CONNECTED',
  );
  const guestSeat = latest!.members.find((m) => m.userId === guest.id)!.seatIndex;
  anotherTab.disconnect();
  await waitFor(
    () => latest?.members.find((m) => m.userId === guest.id)?.status === 'DISCONNECTED',
    'disconnect broadcast',
  );
  const recovered = await connect(guest);
  await command(recovered, 'room:join', room.roomId);
  await waitFor(
    () => latest?.members.find((m) => m.userId === guest.id)?.connectionState === 'CONNECTED',
    'reconnect',
  );
  assert.equal(latest!.members.find((m) => m.userId === guest.id)!.seatIndex, guestSeat);
  const leaveId = crypto.randomUUID();
  assert.equal((await command(recovered, 'member:leave', room.roomId, {}, leaveId)).ok, true);
  assert.equal((await command(recovered, 'member:leave', room.roomId, {}, leaveId)).ok, true);
  await waitFor(() => latest?.members.length === 1, 'leave broadcast');
  assert.equal((await request(`/rooms/${room.roomId}/snapshot`, guest)).response.status, 404);
  await request('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
  await command(recovered, 'room:join', room.roomId);
  console.log('PASS multi-tab presence, disconnect/reconnect, idempotent leave and rejoin');

  for (const member of extra.slice(0, 6)) {
    assert.equal(
      (await request('/rooms/join', member, { code: room.code, requestId: crypto.randomUUID() }))
        .response.status,
      200,
    );
    const socket = await connect(member);
    await command(socket, 'room:join', room.roomId);
  }
  assert.equal(
    (await request('/rooms/join', extra[6], { code: room.code, requestId: crypto.randomUUID() }))
      .data.error.code,
    'ROOM_FULL',
  );
  const [raceA, raceB] = await Promise.all([
    request('/rooms/join', extra[6], { code: other.code, requestId: crypto.randomUUID() }),
    request('/rooms', extra[6], createInput('Concurrent')),
  ]);
  assert.equal([raceA, raceB].filter((r) => r.response.ok).length, 1);
  await request('/auth/logout', guest, {});
  await waitFor(() => !recovered.connected, 'logout closes socket');
  assert.equal((await request('/auth/me', guest)).response.status, 401);
  console.log('PASS capacity, concurrent cross-room membership and session revocation');

  // Restart an active room, then restore from persisted membership and rhythm.
  for (const socket of sockets) socket.disconnect();
  await stop();
  await boot();
  assert.equal((await request('/auth/me', owner)).data.currentRoomId, room.roomId);
  const restored = await connect(owner);
  const restoredAck = await command(restored, 'room:join', room.roomId);
  assert.equal(restoredAck.data?.session.focusSeconds, 3000);
  assert.equal(restoredAck.data?.members.filter((m) => m.userId === owner.id).length, 1);
  restored.disconnect();
  await waitFor(
    async () =>
      (await request(`/rooms/${room.roomId}/snapshot`, owner)).data.session?.phase === 'ENDED',
    'owner grace timeout',
    10000,
  );
  assert.equal(
    (await request('/rooms/join', extra[0], { code: room.code, requestId: crypto.randomUUID() }))
      .data.error.code,
    'ROOM_ENDED',
  );
  console.log('PASS persistent restart recovery and owner disconnect timeout');

  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
  });
  const firstContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const browserErrors: string[] = [];
  for (const page of [first, second])
    page.on('pageerror', (error) => browserErrors.push(error.message));
  async function browserRegister(page: Page, username: string, nickname: string) {
    await page.goto(`${base}/register`);
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('昵称', { exact: true }).fill(nickname);
    await page.getByLabel('密码', { exact: true }).fill('BrowserStudy!42');
    await page.getByRole('button', { name: '创建账号', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('注册成功');
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill('BrowserStudy!42');
    await page.getByRole('button', { name: '登录 FocusSpace' }).click();
    await expect(page.getByRole('heading', { name: '创建自习房间' })).toBeVisible();
  }
  await first.goto(`${base}/login`);
  await first.screenshot({ path: resolve(directory, 'login-desktop.png'), fullPage: true });
  await browserRegister(first, 'browser_owner', '小满');
  await browserRegister(second, 'browser_guest', '知夏');
  await first.screenshot({ path: resolve(directory, 'home-desktop.png'), fullPage: true });
  await first.getByLabel('房间名称', { exact: true }).fill('晚风读书室');
  await first.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(first.getByRole('status').first()).toContainText('实时连接正常');
  const browserRoomUrl = first.url();
  const code = (await first.locator('.invite-code strong').textContent())!;
  await second.getByLabel('房间码', { exact: true }).fill(code);
  await second.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(first.locator('.member-list li')).toHaveCount(2);
  await expect(second.getByRole('status').first()).toContainText('实时连接正常');
  await second.getByRole('button', { name: '我准备好了' }).click();
  await expect(first.locator('.member-list li').filter({ hasText: '知夏' })).toContainText(
    '已准备',
  );
  await second.reload();
  await expect(second.getByRole('button', { name: '取消准备' })).toBeEnabled();
  await first.screenshot({ path: resolve(directory, 'room-desktop.png'), fullPage: true });
  await second.setViewportSize({ width: 390, height: 844 });
  await second.screenshot({ path: resolve(directory, 'room-mobile.png'), fullPage: true });
  assert.equal(
    await second.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    'mobile horizontal overflow',
  );
  await second.getByRole('button', { name: '离开房间', exact: true }).click();
  await second.getByRole('button', { name: '确认离开', exact: true }).click();
  await expect(first.locator('.member-list li')).toHaveCount(1);
  await second.getByLabel('房间码', { exact: true }).fill(code);
  await second.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(first.locator('.member-list li')).toHaveCount(2);
  await first.getByRole('button', { name: '结束共学', exact: true }).click();
  await first.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(second.getByText('这次相聚先到这里')).toBeVisible();
  await first.getByRole('button', { name: '退出登录', exact: true }).click();
  await first.goto(browserRoomUrl);
  await expect(first.getByRole('button', { name: '登录 FocusSpace' })).toBeVisible();
  assert.deepEqual(browserErrors, []);
  console.log(
    'PASS two isolated browser accounts: register → login → create/join → ready sync → refresh → leave/rejoin → owner end → logout guard',
  );
  console.log(`Screenshots and isolated verification database: ${directory}`);
} catch (error) {
  writeFileSync(resolve(directory, 'server.log'), processLog);
  for (const [index, context] of (browser?.contexts() ?? []).entries()) {
    const page = context.pages()[0];
    if (page)
      await page
        .screenshot({ path: resolve(directory, `failure-${index}.png`), fullPage: true })
        .catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.disconnect();
  await stop();
  await database.$disconnect();
}
