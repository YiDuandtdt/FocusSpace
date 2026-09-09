// Visual-only follow-up: reuse an isolated verification database; no production data is touched.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io, type Socket } from 'socket.io-client';
import { chromium, expect, type Page } from '@playwright/test';
import type { Ack } from '@focusspace/shared';
const source = process.argv[2];
assert(source, 'Pass the isolated verify-personal database path');
const directory = mkdtempSync(resolve('.tmp/capture-personal-'));
copyFileSync(source, resolve(directory, 'capture.db'));
const db = new PrismaClient({
  datasourceUrl: `file:${resolve(directory, 'capture.db').replaceAll('\\', '/')}`,
});
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const addr = listener.address();
assert(addr && typeof addr === 'object');
await new Promise<void>((r) => listener.close(() => r()));
const base = `http://127.0.0.1:${addr.port}`;
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {
  env: {
    ...process.env,
    DATABASE_URL: `file:${resolve(directory, 'capture.db').replaceAll('\\', '/')}`,
    HOST: '127.0.0.1',
    PORT: String(addr.port),
    APP_ORIGINS: base,
    COOKIE_SECURE: 'false',
    DEMO_MODE: 'true',
    DISCONNECT_GRACE_MS: '60000',
  },
  windowsHide: true,
  stdio: 'pipe',
});
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(edge) ? { executablePath: edge } : {}),
  args: ['--enable-unsafe-swiftshader'],
});
const people: { id: string; cookie: string; socket: Socket }[] = [];
let roomId = '';
const shots = resolve('Doc/screenshots/personal-space');
mkdirSync(shots, { recursive: true });
async function api(
  path: string,
  p: (typeof people)[number],
  body?: unknown,
  method = body ? 'POST' : 'GET',
) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: { Origin: base, Cookie: p.cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(r.ok, await r.clone().text());
  return r.json();
}
async function command(p: (typeof people)[number], type: string, payload: unknown = {}) {
  const a = await new Promise<Ack>((r) =>
    p.socket.emit(type, { roomId, requestId: crypto.randomUUID(), payload }, r),
  );
  assert(a.ok, JSON.stringify(a.error));
  return a;
}
async function shot(page: Page, name: string, selector?: string) {
  const canvas = page.locator('canvas').first();
  if (await canvas.count()) {
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
  if (selector) {
    await page.locator(selector).screenshot({ path: resolve(shots, name) });
  } else {
    await page.screenshot({ path: resolve(shots, name), fullPage: true });
  }
}
try {
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(base + '/api/health')
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const username of [
    'personal_host',
    ...Array.from({ length: 7 }, (_, i) => `personal_guest_${i}`),
  ]) {
    const r = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'PersonalSpace42!' }),
    });
    assert(r.ok);
    const user = (await r.json()).user,
      cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    const socket = io(base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Origin: base, Cookie: cookie },
    });
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    people.push({ id: user.id, cookie, socket });
  }
  const host = people[0]!;
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1100 },
    deviceScaleFactor: 1,
  });
  await context.addCookies([
    { name: 'focusspace_session', value: host.cookie.split('=')[1]!, url: base },
  ]);
  const page = await context.newPage();
  let personal = await api('/users/me/space', host);
  await api(
    '/users/me/space',
    host,
    {
      character: personal.character,
      space: { ...personal.space, theme: 'library', room: 'room.atelier', sound: 'birds' },
      revision: personal.revision,
    },
    'PUT',
  );
  await api('/users/me', host, { nickname: '小禾', avatarId: 'sage', removeAvatar: true }, 'PATCH');
  await page.goto(base + '/space?setup=1');
  await expect(page.locator('.character-preview canvas')).toBeVisible();
  await shot(page, '01-first-setup.png');
  await page.goto(base + '/space');
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await shot(page, '02-personal-room.png');
  await shot(page, '02b-personal-preview.png', '.personal-preview-panel');
  await page.getByRole('tab', { name: '虚拟形象', exact: true }).click();
  await expect(page.locator('.character-preview canvas')).toBeVisible();
  await shot(page, '03-character.png');
  await shot(page, '03b-character-preview.png', '.personal-preview-panel');
  const room = await api('/rooms', host, {
    name: '小禾的周末书屋',
    focusSeconds: 1500,
    breakSeconds: 300,
    requestId: crypto.randomUUID(),
  });
  roomId = room.roomId;
  await command(host, 'room:join');
  await page.goto(base + '/rooms/' + roomId);
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await shot(page, '04-single-room.png', '.space-panel');
  for (const guest of people.slice(1)) {
    await api('/rooms/join', guest, { code: room.code, requestId: crypto.randomUUID() });
    await command(guest, 'room:join');
  }
  await expect(page.locator('.scene-seat-label.is-occupied')).toHaveCount(8);
  await shot(page, '05-multiplayer-lobby.png', '.space-panel');
  for (const p of people) await command(p, 'member:ready', { ready: true });
  await expect(page.locator('.scene-seat-label[data-status="READY"]')).toHaveCount(8);
  await shot(page, '06-ready.png', '.space-panel');
  await command(host, 'session:start');
  await expect(page.locator('.timer-FOCUS')).toBeVisible();
  await shot(page, '07-focus.png', '.space-panel');
  await shot(page, '07b-focus-scene.png', '.study-space');
  await command(people[6]!, 'member:afk', { afk: true });
  people[7]!.socket.disconnect();
  await expect(page.locator('.scene-seat-label[data-status="DISCONNECTED"]')).toHaveCount(1);
  await shot(page, '08-afk-disconnected.png', '.space-panel');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '09-mobile.png');
  await shot(page, '09b-mobile-scene.png', '.study-space');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1536, height: 1100 });
  await db.studySession.update({
    where: { id: room.sessionId },
    data: { phaseEndAt: new Date(Date.now() - 100) },
  });
  await command(host, 'room:sync');
  await expect(page.locator('.timer-BREAK')).toBeVisible();
  await shot(page, '10-break.png', '.space-panel');
  await command(host, 'session:end');
  await expect(page.locator('.scene-seat-label[data-status="ENDED"]')).toHaveCount(8);
  await shot(page, '11-ended.png', '.space-panel');
  await page.goto(base + '/space');
  await expect(page.locator('.scene-host canvas')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, '12-personal-mobile.png');
  await page.setViewportSize({ width: 1536, height: 1100 });
  await page.getByRole('button', { name: '暖灯夜读', exact: true }).click();
  await page.getByRole('button', { name: '拱窗小筑', exact: true }).click();
  await shot(page, '13-night-arch.png', '.personal-preview-panel');
  await page.getByRole('button', { name: '窗边雨天', exact: true }).click();
  await shot(page, '14-rain-arch.png', '.personal-preview-panel');
  console.log(
    'PASS final visual captures: single, 8 members, seven states, mobile, night and rain variants',
  );
} finally {
  await browser.close();
  people.forEach((p) => p.socket.disconnect());
  server.kill();
  await once(server, 'exit');
  await db.$disconnect();
}
