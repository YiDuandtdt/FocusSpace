import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import type { Ack, Member, RoomSnapshot } from '@focusspace/shared';
import { createAvatar } from '../apps/web/src/features/space/AvatarModel';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/space-'));
const databaseUrl = `file:${resolve(directory, 'verify.db').replaceAll('\\', '/')}`;
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
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (data) => {
  log += data;
});
server.stderr.on('data', (data) => {
  log += data;
});
const sockets: Socket[] = [];
let browser: Browser | undefined;
const errors: string[] = [];
type Actor = { id: string; cookie: string; socket: Socket; nickname: string };
async function api(path: string, actor?: Actor, body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function actor(index: number): Promise<Actor> {
  const body = {
    username: `space_${index}`,
    nickname: ['听雨', '小禾', '紫苏', '向阳', '阿澄', '青苗', '书页', '晓光'][index] ?? '新同桌',
    avatarId: ['lake', 'sage', 'lilac', 'sun'][index % 4],
    password: 'StudySpace42!',
  };
  const registered = await api('/auth/register', undefined, body);
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert(response.ok);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const socket = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: base },
    reconnection: false,
  });
  sockets.push(socket);
  const connected = once(socket, 'connect');
  socket.connect();
  await connected;
  return { id: registered.user.id, cookie, socket, nickname: body.nickname };
}
let roomId = '';
async function command(actor: Actor, type: string, payload: unknown = {}): Promise<RoomSnapshot> {
  const ack = await new Promise<Ack>((done, reject) =>
    actor.socket
      .timeout(8000)
      .emit(
        type,
        { roomId, payload, requestId: crypto.randomUUID() },
        (error: Error | null, ack: Ack) => (error ? reject(error) : done(ack)),
      ),
  );
  assert(ack.ok, JSON.stringify(ack.error));
  return ack.data!;
}
const seatMap = (page: Page) =>
  page
    .locator('.scene-seat-label')
    .evaluateAll((labels) =>
      labels.map((label) => [label.getAttribute('data-seat'), label.getAttribute('data-user-id')]),
    );
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: resolve(directory, name), fullPage: true });
}

try {
  await expect
    .poll(
      () =>
        fetch(`${base}/api/health`)
          .then((r) => r.ok)
          .catch(() => false),
      { timeout: 15000 },
    )
    .toBe(true);
  const people: Actor[] = [];
  for (let index = 0; index < 8; index++) people.push(await actor(index));
  const owner = people[0]!,
    guest = people[1]!;
  const room = await api('/rooms', owner, {
    name: '窗边 · 一起读完这一章',
    focusSeconds: 1500,
    breakSeconds: 300,
    requestId: crypto.randomUUID(),
  });
  roomId = room.roomId;
  await command(owner, 'room:join');
  for (const person of people.slice(1)) {
    await api('/rooms/join', person, { code: room.code, requestId: crypto.randomUUID() });
    await command(person, 'room:join');
  }
  const snapshot = await command(owner, 'room:sync');
  // Check non-color pose distinctions directly through the replaceable avatar interface.
  const member = snapshot.members[0]!;
  const model = createAvatar(member);
  model.update({ ...member, status: 'FOCUSING' });
  assert(model.root.children[0]!.rotation.x > 0);
  model.update({ ...member, status: 'BREAKING' });
  assert(model.root.children[0]!.rotation.x < 0);
  model.update({ ...member, status: 'AFK' });
  assert.equal(model.root.visible, false);
  model.update({ ...member, status: 'DISCONNECTED' });
  assert.equal(model.root.visible, true);
  model.root.traverse((object) => {
    if ('material' in object) assert.equal((object.material as { opacity: number }).opacity, 0.32);
  });
  model.dispose();
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
    args: ['--enable-unsafe-swiftshader'],
  });
  const ctxA = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 2,
  });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const [context, person] of [
    [ctxA, owner],
    [ctxB, guest],
  ] as const) {
    const [name, value] = person.cookie.split('=');
    await context.addCookies([{ name: name!, value: value!, url: base }]);
    // Test-only renderer instrumentation; no diagnostics are shipped in application code.
    await context.addInitScript(() => {
      const state = { draws: 0, deleted: 0, contexts: [] as WebGL2RenderingContext[] };
      Object.assign(window, { spaceProbe: state });
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
        const gl = (original as Function).apply(this, args);
        if (args[0] === 'webgl2' && gl && !state.contexts.includes(gl)) {
          state.contexts.push(gl);
          for (const name of ['drawElements', 'drawArrays']) {
            const draw = gl[name].bind(gl);
            gl[name] = (...values: any[]) => {
              state.draws++;
              return draw(...values);
            };
          }
          const remove = gl.deleteBuffer.bind(gl);
          gl.deleteBuffer = (...values: any[]) => {
            state.deleted++;
            return remove(...values);
          };
        }
        return gl;
      } as typeof original;
    });
  }
  const pageA = await ctxA.newPage();
  let pageB = await ctxB.newPage();
  for (const page of [pageA, pageB]) page.on('pageerror', (e) => errors.push(e.message));
  let audioRequests = 0;
  pageA.on('request', (request) => {
    if (request.url().endsWith('.wav')) audioRequests++;
  });
  await Promise.all([pageA.goto(`${base}/rooms/${roomId}`), pageB.goto(`${base}/rooms/${roomId}`)]);
  await expect(pageA.locator('.scene-host canvas')).toBeVisible({ timeout: 15000 });
  await expect(pageB.locator('.scene-host canvas')).toBeVisible({ timeout: 15000 });
  await expect(pageA.locator('.scene-seat-label.is-occupied')).toHaveCount(8);
  const initial = await seatMap(pageA);
  assert.deepEqual(await seatMap(pageB), initial);
  assert.equal(audioRequests, 0, 'audio defaults off and does not preload');
  assert(await pageA.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused));
  assert(
    await pageA.locator('canvas').evaluate((canvas) => canvas.width / canvas.clientWidth <= 1.51),
  );
  await screenshot(pageA, 'eight-seats-desktop.png');
  await screenshot(pageB, 'eight-seats-mobile.png');
  assert.equal(
    await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  console.log(
    'PASS eight actual WebGL avatars, identical server seats on desktop/mobile, 1.5 DPR cap, audio off',
  );

  await pageA.getByRole('button', { name: '播放雨声', exact: true }).click();
  await expect
    .poll(() => pageA.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0.2);
  await pageA.getByLabel('环境音音量').fill('24');
  assert.equal(await pageA.locator('audio').evaluate((a: HTMLAudioElement) => a.volume), 0.24);
  assert(await pageB.locator('audio').evaluate((a: HTMLAudioElement) => a.paused));
  await pageA.locator('audio').evaluate((a: HTMLAudioElement) => {
    a.currentTime = a.duration - 0.2;
  });
  await expect
    .poll(() => pageA.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeLessThan(2);
  await pageA.getByRole('button', { name: '暂停雨声' }).click();
  assert(await pageA.locator('audio').evaluate((a: HTMLAudioElement) => a.paused));
  console.log(
    'PASS audible-file playback progress, independent volume, seamless loop boundary and pause',
  );

  await command(guest, 'member:afk', { afk: true });
  await expect(pageA.locator(`.scene-seat-label[data-user-id="${guest.id}"]`)).toHaveAttribute(
    'data-status',
    'AFK',
  );
  await command(guest, 'member:afk', { afk: false });
  await pageB.close();
  guest.socket.disconnect();
  await expect(pageA.locator(`.scene-seat-label[data-user-id="${guest.id}"]`)).toHaveAttribute(
    'data-status',
    'DISCONNECTED',
  );
  pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => errors.push(e.message));
  await pageB.goto(`${base}/rooms/${roomId}`);
  await expect(pageA.locator(`.scene-seat-label[data-user-id="${guest.id}"]`)).toHaveAttribute(
    'data-status',
    'JOINED',
  );
  await expect(pageB.locator('.scene-host canvas')).toBeVisible();
  assert.deepEqual(await seatMap(pageA), initial);
  await pageB.reload();
  await expect(pageB.locator('.scene-host canvas')).toBeVisible();
  assert.deepEqual(await seatMap(pageB), initial);
  await command(people[3]!, 'member:leave');
  await expect(pageA.locator('.scene-seat-label.is-occupied')).toHaveCount(7);
  const replacement = await actor(8);
  await api('/rooms/join', replacement, { code: room.code, requestId: crypto.randomUUID() });
  await command(replacement, 'room:join');
  await expect(pageA.locator('.scene-seat-label.is-occupied')).toHaveCount(8);
  const replaced = await seatMap(pageA);
  assert.deepEqual(
    replaced.filter(([seat]) => seat !== '3'),
    initial.filter(([seat]) => seat !== '3'),
  );
  assert.equal(replaced[3]![1], replacement.id);
  console.log(
    'PASS AFK, disconnect/reconnect, reload, leave/replacement without moving remaining avatars',
  );

  await pageB.getByRole('button', { name: '我准备好了' }).click();
  for (const person of [...people.filter((_, i) => i !== 1 && i !== 3), replacement])
    await command(person, 'member:ready', { ready: true });
  await expect(pageA.locator('.scene-seat-label[data-status="READY"]')).toHaveCount(8);
  await command(owner, 'session:start');
  await expect(pageA.locator('.scene-seat-label[data-status="FOCUSING"]')).toHaveCount(8);
  await expect(pageB.getByRole('timer')).toBeVisible();
  await screenshot(pageA, 'focus-desktop.png');
  await screenshot(pageB, 'focus-mobile.png');
  // Simulate hidden document, then let the existing room subscription deliver a new state.
  await pageA.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const drawCount = await pageA.evaluate(() => (window as any).spaceProbe.draws);
  await command(replacement, 'member:afk', { afk: true });
  await expect(
    pageA.locator(`.scene-seat-label[data-user-id="${replacement.id}"]`),
  ).toHaveAttribute('data-status', 'AFK');
  await pageA.waitForTimeout(250);
  assert.equal(await pageA.evaluate(() => (window as any).spaceProbe.draws), drawCount);
  await pageA.evaluate(() => {
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => pageA.evaluate(() => (window as any).spaceProbe.draws))
    .toBeGreaterThan(drawCount);
  await pageA.emulateMedia({ reducedMotion: 'reduce' });
  await pageA.waitForTimeout(150);
  const reducedDraws = await pageA.evaluate(() => (window as any).spaceProbe.draws);
  await pageA.waitForTimeout(250);
  assert.equal(await pageA.evaluate(() => (window as any).spaceProbe.draws), reducedDraws);
  await pageA.emulateMedia({ reducedMotion: 'no-preference' });

  // Real context loss must release GPU buffers and preserve all ordinary controls.
  await pageA.evaluate(() => {
    (window as any).spaceProbe.contexts.at(-1).getExtension('WEBGL_lose_context').loseContext();
  });
  await expect(
    pageA.getByText('3D 空间暂不可用，已显示座位卡片。计时、任务和聊天仍可使用。'),
  ).toBeVisible();
  await expect(pageA.locator('.seat-card')).toHaveCount(8);
  assert((await pageA.evaluate(() => (window as any).spaceProbe.deleted)) > 0);
  await pageA.getByLabel('新任务', { exact: true }).fill('降级时也能推进目标');
  await pageA.getByRole('button', { name: '添加任务' }).click();
  await expect(pageA.getByRole('checkbox', { name: '完成任务：降级时也能推进目标' })).toBeVisible();
  // Advance only the isolated server fixture; 3D never decides phase transitions.
  await database.studySession.update({
    where: { id: room.sessionId },
    data: { phaseEndAt: new Date(Date.now() - 100) },
  });
  await command(owner, 'room:sync');
  await expect(pageA.locator('.timer-BREAK')).toBeVisible();
  await expect(pageB.locator('.scene-seat-label[data-status="BREAKING"]')).toHaveCount(7);
  await pageA.getByLabel('休息消息', { exact: true }).fill('雨声和这张桌子刚刚好');
  await pageA.getByRole('button', { name: '发送消息' }).click();
  await expect(pageB.getByRole('log')).toContainText('雨声和这张桌子刚刚好');
  await screenshot(pageA, 'fallback-desktop.png');
  await pageA.getByRole('button', { name: '重试 3D' }).click();
  await expect(pageA.locator('.scene-host canvas')).toBeVisible();
  await screenshot(pageA, 'break-desktop.png');
  console.log(
    'PASS poses, hidden/reduced-motion rendering pause, context loss cleanup, fallback tasks/timer/chat and retry',
  );

  // JS chunk failure and no WebGL are separate failure paths.
  await pageB.route('**/assets/StudyRoomScene-*.js', (route) => route.abort());
  await pageB.reload();
  await expect(pageB.locator('.seat-card')).toHaveCount(8);
  await expect(pageB.getByRole('button', { name: '重试 3D' })).toBeVisible();
  await pageB.unroute('**/assets/StudyRoomScene-*.js');
  await pageB.reload();
  await expect(pageB.locator('.scene-host canvas')).toBeVisible();
  await pageB.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
      return args[0] === 'webgl2' ? null : (original as Function).apply(this, args);
    } as typeof original;
  });
  await pageB.reload();
  await expect(pageB.getByRole('button', { name: '重试 3D' })).toBeVisible();
  await expect(pageB.getByRole('timer')).toBeVisible();
  await expect(pageB.getByLabel('新任务', { exact: true })).toBeEnabled();
  await pageB.route('**/audio/window-rain.wav', (route) => route.abort());
  await pageB.getByRole('button', { name: '播放雨声', exact: true }).click();
  await expect(pageB.locator('.audio-error')).toBeVisible();
  await screenshot(pageB, 'fallback-mobile.png');
  await pageA.getByRole('button', { name: '播放雨声', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '暂停雨声' })).toBeVisible();
  await pageA.evaluate(() =>
    Object.assign(window, {
      priorAudio: document.querySelector('audio'),
      priorCanvas: document.querySelector('canvas'),
    }),
  );
  await pageA.getByRole('link', { name: '我的空间', exact: true }).click();
  assert(
    await pageA.evaluate(
      () =>
        (window as any).priorAudio.paused &&
        !(window as any).priorAudio.getAttribute('src') &&
        !(window as any).priorCanvas.isConnected,
    ),
  );
  assert(await pageA.evaluate(() => (window as any).spaceProbe.contexts.at(-1).isContextLost()));
  assert.deepEqual(errors, []);
  console.log(
    `PASS chunk failure, no WebGL, audio error, navigation resource cleanup. Artifacts: ${directory}`,
  );
} catch (error) {
  writeFileSync(resolve(directory, 'server.log'), log);
  for (const [i, context] of (browser?.contexts() ?? []).entries())
    await context
      .pages()[0]
      ?.screenshot({ path: resolve(directory, `failure-${i}.png`), fullPage: true })
      .catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  sockets.forEach((socket) => socket.disconnect());
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  await database.$disconnect();
}
