import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import {
  DEFAULT_CHARACTER,
  DEFAULT_SPACE,
  GROWTH_CATALOG,
  type PersonalSpace,
  type RoomSnapshot,
  type Ack,
} from '@focusspace/shared';
import sharp from 'sharp';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/personal-'));
const screenshots = resolve('Doc/screenshots/personal-space');
mkdirSync(screenshots, { recursive: true });
const databaseUrl = `file:${resolve(directory, 'verify.db').replaceAll('\\', '/')}`;
const legacy = new DatabaseSync(resolve(directory, 'verify.db'));
// Exercise every pre-upgrade migration, then seed real legacy rows before the additive migration.
const migrations = readdirSync('prisma/migrations')
  .filter((n) => n.startsWith('20'))
  .sort();
for (const name of migrations.filter((n) => n < '202609090001_personal_space'))
  legacy.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
const passwordHash = await hash('PersonalSpace42!', 4);
legacy
  .prepare('INSERT INTO User(id,username,passwordHash,nickname) VALUES(?,?,?,?)')
  .run('legacy-user', 'legacy_reader', passwordHash, '旧日读者');
legacy.exec(`INSERT INTO StudySession(id,phase,focusSeconds,breakSeconds,endedAt,startedAt) VALUES('legacy-session','ENDED',1500,300,1725687600000,1725686000000);
INSERT INTO Room(id,code,name,ownerId,sessionId,theme) VALUES('legacy-room','LEG234','旧日书屋','legacy-user','legacy-session','rain');
INSERT INTO RoomMember(id,roomId,userId,seatIndex) VALUES('legacy-member','legacy-room','legacy-user',0);
INSERT INTO StudyRecord(id,sessionId,userId,focusSeconds,roundsCompleted,tasksDone,tasksTotal,studiedWith) VALUES('legacy-record','legacy-session','legacy-user',1234,1,2,3,1);`);
const recordBefore = legacy.prepare('SELECT * FROM StudyRecord').all();
const sessionBefore = legacy.prepare('SELECT * FROM StudySession').all();
legacy.exec(readFileSync('prisma/migrations/202609090001_personal_space/migration.sql', 'utf8'));
assert.deepEqual(legacy.prepare('SELECT * FROM StudyRecord').all(), recordBefore);
assert.deepEqual(legacy.prepare('SELECT * FROM StudySession').all(), sessionBefore);
assert.equal(legacy.prepare('SELECT COUNT(*) n FROM PersonalSpace').get()!.n, 1);
assert.equal(legacy.prepare('SELECT onboarding FROM User').get()!.onboarding, 'SKIPPED');
for (const name of migrations.filter((n) => n > '202609090001_personal_space'))
  legacy.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
legacy.close();
console.log('PASS incremental migration preserves legacy session and study record exactly');
const database = new PrismaClient({ datasourceUrl: databaseUrl });
// Geometry/editor regression fixture: grant catalog assets only in this disposable database.
async function grantTestAssets(userId: string) {
  for (const item of GROWTH_CATALOG)
    await database.ownedAsset.upsert({
      where: { userId_assetId: { userId, assetId: item.id } },
      create: { userId, assetId: item.id, source: 'ISOLATED_TEST' },
      update: {},
    });
}
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
await new Promise<void>((done) => listener.close(() => done()));
const base = `http://127.0.0.1:${address.port}`;
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    HOST: '127.0.0.1',
    PORT: String(address.port),
    APP_ORIGINS: base,
    COOKIE_SECURE: 'false',
    DEMO_MODE: 'true',
    DISCONNECT_GRACE_MS: '60000',
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => {
  log += d;
});
server.stderr.on('data', (d) => {
  log += d;
});
type Actor = { id: string; cookie: string; socket: Socket };
const actors: Actor[] = [];
let browser: Browser | undefined;
const errors: string[] = [];
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
  assert(response.ok, `${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
async function login(username: string): Promise<Actor> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'PersonalSpace42!' }),
  });
  assert(response.ok, await response.clone().text());
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!,
    user = (await response.json()).user;
  const socket = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: base },
    reconnection: false,
  });
  const ready = once(socket, 'connect');
  socket.connect();
  await ready;
  const actor = { id: user.id, cookie, socket };
  await grantTestAssets(user.id);
  actors.push(actor);
  return actor;
}
async function command(
  actor: Actor,
  roomId: string,
  type: string,
  payload: unknown = {},
): Promise<RoomSnapshot> {
  const ack = await new Promise<Ack>((done, reject) =>
    actor.socket
      .timeout(10000)
      .emit(type, { roomId, requestId: crypto.randomUUID(), payload }, (e: Error | null, a: Ack) =>
        e ? reject(e) : done(a),
      ),
  );
  assert(ack.ok, `${type}: ${JSON.stringify(ack.error)}`);
  return ack.data!;
}
async function pageFor(actor: Actor, width = 1536, height = 1100) {
  const context = await browser!.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const token = actor.cookie.slice(actor.cookie.indexOf('=') + 1);
  await context.addCookies([{ name: 'focusspace_session', value: token, url: base }]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  return page;
}
async function shot(page: Page, name: string, selector?: string) {
  if (selector) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.locator(selector).screenshot({ path: resolve(screenshots, name) });
  } else {
    const canvas = page.locator('canvas').first();
    if (await canvas.count()) {
      await canvas.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: resolve(screenshots, name), fullPage: true });
  }
}
try {
  for (let i = 0; i < 80; i++) {
    if (
      await fetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert((await fetch(`${base}/api/health`)).ok, log);
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(edge) ? { executablePath: edge } : {}),
    args: ['--enable-unsafe-swiftshader'],
  });
  const setup = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  setup.on('pageerror', (e) => errors.push(e.message));
  await setup.goto(`${base}/register`);
  await setup.getByLabel('账号', { exact: true }).fill('personal_host');
  await setup.getByLabel('昵称', { exact: true }).fill('小禾');
  await setup.getByLabel('密码', { exact: true }).fill('PersonalSpace42!');
  await setup.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(setup).toHaveURL(/\/space\?setup=1/);
  await expect(setup.locator('.character-preview canvas')).toBeVisible();
  await shot(setup, '01-first-setup.png');
  await grantTestAssets(
    (await database.user.findUniqueOrThrow({ where: { username: 'personal_host' } })).id,
  );
  await setup.reload();
  await setup.getByRole('button', { name: '灵感手记' }).click();
  await setup.getByRole('button', { name: '下一步：看看空间' }).click();
  await expect(setup.locator('.scene-host canvas')).toBeVisible();
  await setup.getByRole('button', { name: '保存并开始学习' }).click();
  await expect(setup).toHaveURL(base + '/');
  const host = await login('personal_host');
  await setup.close();
  const page = await pageFor(host);
  await page.goto(`${base}/space`);
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  let personal: PersonalSpace = await request('/users/me/space', host);
  assert.equal(personal.onboarding, 'DONE');
  assert.equal(personal.character.outfit, 'outfit.clay');
  // Actual editor save, cancel, default preview, and retained draft on failed save.
  await page.getByRole('button', { name: '拱窗小筑', exact: true }).click();
  await page.route('**/api/users/me/space', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'DATABASE_UNAVAILABLE', message: '定向验证：保存暂不可用' },
        }),
      });
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存搭配', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('当前编辑内容已保留');
  await expect(page.getByRole('button', { name: '拱窗小筑', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.unroute('**/api/users/me/space');
  await page.getByRole('button', { name: '保存搭配', exact: true }).click();
  await expect(page.getByText('已保存。形象随你入座')).toBeVisible();
  personal = await request('/users/me/space', host);
  assert.equal(personal.space.room, 'room.arch');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '拱窗小筑', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '窗边书屋', exact: true }).click();
  await page.getByRole('link', { name: '兑换更多装扮' }).click();
  await expect(page.getByRole('heading', { name: '尚未保存修改' })).toBeVisible();
  await expect(page).toHaveURL(base + '/space');
  await page.getByRole('button', { name: '继续编辑' }).click();
  await page.getByRole('link', { name: '兑换更多装扮' }).click();
  await page.getByRole('button', { name: '放弃修改并离开' }).click();
  await expect(page).toHaveURL(base + '/growth');
  await page.goto(`${base}/space`);
  await page.reload();
  await expect(page.getByRole('button', { name: '拱窗小筑', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await shot(page, '02-personal-room.png');
  await page.getByRole('tab', { name: '虚拟形象', exact: true }).click();
  await expect(page.locator('.character-preview canvas')).toBeVisible();
  const characterCanvas = page.locator('.character-preview canvas');
  const characterBefore = await characterCanvas.evaluate((canvas: HTMLCanvasElement) =>
    canvas.toDataURL(),
  );
  const characterBox = await characterCanvas.boundingBox();
  assert(characterBox);
  await page.mouse.move(
    characterBox.x + characterBox.width * 0.45,
    characterBox.y + characterBox.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    characterBox.x + characterBox.width * 0.68,
    characterBox.y + characterBox.height * 0.5,
  );
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.notEqual(
    await characterCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL()),
    characterBefore,
  );
  await characterCanvas.dispatchEvent('wheel', { deltaY: -120 });
  await shot(page, '03-character.png');
  console.log(
    'PASS registration onboarding, editing save/reload, cancel/default preview, retained draft on save failure',
  );
  // Skip from the actual first setup page on a second new account.
  await request('/auth/register', undefined, {
    username: 'skip_reader',
    password: 'PersonalSpace42!',
    nickname: '稍后搭配',
  });
  const skipper = await login('skip_reader');
  const skipPage = await pageFor(skipper);
  await skipPage.goto(`${base}/space?setup=1`);
  await skipPage.getByRole('button', { name: '跳过，直接开始' }).click();
  await expect(skipPage).toHaveURL(base + '/');
  assert.equal((await request('/users/me/space', skipper)).onboarding, 'SKIPPED');
  await skipPage.close();
  const validBody = {
    character: personal.character,
    space: personal.space,
    revision: personal.revision,
  };
  for (const body of [
    { ...validBody, userId: skipper.id },
    {
      ...validBody,
      space: { ...personal.space, slots: { ...personal.space.slots, wall: 'desktop.tea' } },
    },
    { ...validBody, character: { ...personal.character, outfit: 'paid.secret' } },
  ]) {
    const r = await fetch(`${base}/api/users/me/space`, {
      method: 'PUT',
      headers: { Origin: base, Cookie: host.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 400);
  }
  const conflict = await fetch(`${base}/api/users/me/space`, {
    method: 'PUT',
    headers: { Origin: base, Cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validBody, revision: 999 }),
  });
  assert.equal(conflict.status, 409);
  const unauth = await fetch(`${base}/api/users/me/space`);
  assert.equal(unauth.status, 401);
  for (const [type, bytes] of [
    ['image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/jpeg', Buffer.alloc(2 * 1024 * 1024 + 1)],
    ['image/png', Buffer.from('not an image')],
  ] as const) {
    const r = await fetch(`${base}/api/users/me/avatar`, {
      method: 'POST',
      headers: { Origin: base, Cookie: host.cookie, 'Content-Type': type },
      body: bytes,
    });
    assert([400, 413].includes(r.status));
  }
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#88a27c' } })
    .png()
    .toBuffer();
  const uploaded = await fetch(`${base}/api/users/me/avatar`, {
    method: 'POST',
    headers: { Origin: base, Cookie: host.cookie, 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(uploaded.status, 200);
  const avatarUser = (await uploaded.json()).user;
  const avatarBytes = await fetch(`${base}${avatarUser.avatarUrl}`, {
    headers: { Cookie: host.cookie },
  }).then((r) => r.arrayBuffer());
  const meta = await sharp(Buffer.from(avatarBytes)).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.deepEqual(avatarUser.character, personal.character);
  const external = await fetch(`${base}/api/users/me`, {
    method: 'PATCH',
    headers: { Origin: base, Cookie: host.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nickname: '小禾',
      avatarId: 'lake',
      avatarUrl: 'https://example.com/x.png',
    }),
  });
  assert.equal(external.status, 400);
  console.log(
    'PASS skip onboarding, authentication, strict ownership/asset/slot validation, revision conflict and safe image decoding',
  );
  const room = await request('/rooms', host, {
    name: '小禾的周末书屋',
    focusSeconds: 1500,
    breakSeconds: 300,
    requestId: crypto.randomUUID(),
  });
  let snapshot = await command(host, room.roomId, 'room:join');
  const frozen = snapshot.room.spaceSnapshot;
  assert.equal(frozen?.ownerId, host.id);
  assert.deepEqual(frozen?.config, personal.space);
  await page.goto(`${base}/rooms/${room.roomId}`);
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await shot(page, '04-single-room.png', '.space-panel');
  const guests: Actor[] = [];
  for (let i = 0; i < 7; i++) {
    await request('/auth/register', undefined, {
      username: `personal_guest_${i}`,
      nickname: ['听雨', '阿澄', '书页', '向阳', '青苗', '晓光', '紫苏'][i],
      password: 'PersonalSpace42!',
    });
    const guest = await login(`personal_guest_${i}`);
    guests.push(guest);
    const own: PersonalSpace = await request('/users/me/space', guest);
    await request(
      '/users/me/space',
      guest,
      {
        character: {
          ...DEFAULT_CHARACTER,
          skin: ['skin.cream', 'skin.honey', 'skin.cocoa'][i % 3],
          hair: ['hair.crop', 'hair.bob', 'hair.bun'][i % 3],
          hairColor: ['hair.ink', 'hair.chestnut', 'hair.wheat'][i % 3],
          outfit: ['outfit.sage', 'outfit.blue', 'outfit.lilac', 'outfit.clay'][i % 4],
          accessory: [
            'accessory.glasses',
            'accessory.headphones',
            'accessory.beret',
            'accessory.none',
          ][i % 4],
        },
        space: own.space,
        revision: own.revision,
        onboarding: 'DONE',
      },
      'PUT',
    );
    await request('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
    await command(guest, room.roomId, 'room:join');
  }
  const pageB = await pageFor(guests[0]!);
  await pageB.goto(`${base}/rooms/${room.roomId}`);
  await expect(page.locator('.scene-seat-label.is-occupied')).toHaveCount(8);
  await expect(pageB.locator('.scene-seat-label.is-occupied')).toHaveCount(8);
  const a = await command(host, room.roomId, 'room:sync'),
    b = await command(guests[0]!, room.roomId, 'room:sync');
  assert.deepEqual(a.room, b.room);
  assert.deepEqual(a.members, b.members);
  await shot(page, '05-multiplayer-lobby.png', '.space-panel');
  const sceneMap = (p: Page) =>
    p.locator('.scene-seat-label').evaluateAll((labels) =>
      labels.map((l) => ({
        seat: (l as HTMLElement).dataset.seat,
        user: (l as HTMLElement).dataset.userId,
        status: (l as HTMLElement).dataset.status,
      })),
    );
  assert.deepEqual(await sceneMap(page), await sceneMap(pageB));
  personal = await request('/users/me/space', host);
  await request(
    '/users/me/space',
    host,
    {
      character: { ...personal.character, outfit: 'outfit.blue' },
      space: { ...personal.space, theme: 'night', sound: 'fire' },
      revision: personal.revision,
    },
    'PUT',
  );
  snapshot = await command(guests[0]!, room.roomId, 'room:sync');
  assert.deepEqual(snapshot.room.spaceSnapshot, frozen);
  assert.equal(
    snapshot.members.find((m) => m.userId === host.id)?.character?.outfit,
    'outfit.blue',
  );
  await command(host, room.roomId, 'room:transfer', { targetId: guests[0]!.id });
  snapshot = await command(guests[0]!, room.roomId, 'room:sync');
  assert.equal(snapshot.room.ownerId, guests[0]!.id);
  assert.deepEqual(snapshot.room.spaceSnapshot, frozen);
  const denied = await new Promise<Ack>((done) =>
    guests[0]!.socket.emit(
      'room:theme',
      { roomId: room.roomId, requestId: crypto.randomUUID(), payload: { theme: 'night' } },
      done,
    ),
  );
  assert.equal(denied.error?.code, 'SPACE_FROZEN');
  assert(await page.locator('audio').evaluate((e: HTMLAudioElement) => e.paused));
  assert(await pageB.locator('audio').evaluate((e: HTMLAudioElement) => e.paused));
  for (const actor of [host, ...guests])
    await command(actor, room.roomId, 'member:ready', { ready: true });
  await expect(page.locator('.scene-seat-label[data-status="READY"]')).toHaveCount(8);
  await shot(page, '06-ready.png', '.space-panel');
  await command(guests[0]!, room.roomId, 'session:start');
  await expect(page.locator('.scene-seat-label[data-status="FOCUSING"]')).toHaveCount(8);
  await shot(page, '07-focus.png', '.space-panel');
  await command(guests[5]!, room.roomId, 'member:afk', { afk: true });
  guests[6]!.socket.disconnect();
  await expect(page.locator('.scene-seat-label[data-status="DISCONNECTED"]')).toHaveCount(1);
  await expect(page.locator('.scene-seat-label[data-status="AFK"]')).toHaveCount(1);
  await shot(page, '08-afk-disconnected.png', '.space-panel');
  const mobile = await pageFor(host, 390, 844);
  await mobile.goto(`${base}/rooms/${room.roomId}`);
  await expect(mobile.locator('.scene-host canvas')).toBeVisible();
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await shot(mobile, '09-mobile.png');
  await mobile.close();
  await pageB.reload();
  await expect(pageB.locator('.scene-host canvas')).toBeVisible();
  assert.deepEqual(await sceneMap(page), await sceneMap(pageB));
  assert.deepEqual(
    (await command(guests[0]!, room.roomId, 'room:sync')).room.spaceSnapshot,
    frozen,
  );
  await database.studySession.update({
    where: { id: room.sessionId },
    data: { phaseEndAt: new Date(Date.now() - 100) },
  });
  await command(guests[0]!, room.roomId, 'room:sync');
  await expect(page.locator('.timer-BREAK')).toBeVisible();
  await shot(page, '10-break.png', '.space-panel');
  await command(guests[0]!, room.roomId, 'session:end');
  await expect(page.locator('.scene-seat-label[data-status="ENDED"]')).toHaveCount(8);
  await shot(page, '11-ended.png', '.space-panel');
  assert.equal((await request('/users/me/history', host)).total, 1);
  const next = await request('/rooms', host, {
    name: '再来一段安静时光',
    focusSeconds: 1500,
    breakSeconds: 300,
    requestId: crypto.randomUUID(),
  });
  const nextSnap = await command(host, next.roomId, 'room:join');
  assert.equal(nextSnap.room.spaceSnapshot?.config.theme, 'night');
  assert.equal(nextSnap.members[0]?.character?.outfit, 'outfit.blue');
  await command(host, next.roomId, 'session:end');
  const old = await login('legacy_reader');
  const oldSnapshot = await request('/rooms/legacy-room/snapshot', old);
  assert.equal(oldSnapshot.room.spaceSnapshot, null);
  assert.equal(oldSnapshot.room.theme, 'rain');
  assert.equal((await request('/users/me/history', old)).items[0].record.focusSeconds, 1234);
  await pageB.goto(`${base}/space`);
  await expect(pageB.locator('.scene-host canvas')).toBeVisible();
  await pageB.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await pageB.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await shot(pageB, '12-personal-mobile.png');
  assert.deepEqual(errors, []);
  console.log(
    'PASS eight-member scene consistency, personal avatar broadcast, frozen room snapshot, transfer permissions, all seven states, reconnect/mobile, next session reuse and legacy history',
  );
  writeFileSync(
    resolve(screenshots, 'verification.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: 'isolated legacy fixture',
        typecheck: 'pass',
        build: 'pass',
        runtimeErrors: errors,
        screenshots: readdirSync(screenshots).filter((n) => n.endsWith('.png')),
        checks: [
          'onboarding save/skip',
          'editor save/cancel/default/failure retention',
          'strict asset/slot/owner validation',
          'safe avatar decode/re-encode',
          '8 members consistent scene',
          '7 real member states',
          'transfer freezes assets',
          'personal edits affect next room',
          'cross-room character',
          'reconnect',
          'mobile overflow',
          'legacy migration/session/record',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  writeFileSync(resolve(directory, 'server.log'), log);
  for (const [i, c] of (browser?.contexts() ?? []).entries())
    await c
      .pages()[0]
      ?.screenshot({ path: resolve(directory, `failure-${i}.png`), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  actors.forEach((a) => a.socket.disconnect());
  if (server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  await database.$disconnect();
}
