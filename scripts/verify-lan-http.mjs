import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

// Use an actual non-loopback HTTP origin: localhost would conceal this regression.
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/lan-http-'));
const host =
  Object.values(networkInterfaces())
    .flat()
    .find((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    ?.address ?? 'focusspace.test';
const listener = createServer();
listener.listen(0, '0.0.0.0');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = `http://${host}:${port}`;
const local = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: `file:${resolve(directory, 'verify.db').replaceAll('\\', '/')}`,
  PORT: String(port),
  HOST: '0.0.0.0',
  APP_ORIGINS: `${base},${local}`,
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'false',
};
const database = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
await database.$connect();
await database.$disconnect();
const migration = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { env, encoding: 'utf8', windowsHide: true },
);
assert.equal(migration.status, 0, migration.stdout + migration.stderr);
let log = '';
const server = spawn(process.execPath, ['scripts/start.mjs'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => {
  log += chunk;
});
server.stderr.on('data', (chunk) => {
  log += chunk;
});
let browser;
const errors = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`${local}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    ) {
      ready = true;
      break;
    }
    if (server.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(ready, log);
  const handshake = `${local}/socket.io/?EIO=4&transport=polling`;
  for (const headers of [
    { Referer: base + '/', 'Sec-Fetch-Site': 'same-origin' },
    { Referer: base + '/' },
    { Origin: base },
  ]) {
    const response = await fetch(handshake, { headers });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^0\{"sid":/);
  }
  for (const headers of [
    {},
    { Referer: 'http://untrusted.invalid/' },
    { Referer: 'invalid' },
    { Origin: 'http://untrusted.invalid', Referer: base + '/' },
    { Origin: 'null', Referer: base + '/' },
    { Referer: base + '/', 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const response = await fetch(handshake, { headers });
    assert.equal(response.status, 403);
    await response.text();
  }
  browser = await chromium.launch({
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP focusspace.test 127.0.0.1'],
  });
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  for (const [page, username] of [
    [pageA, 'lan_http_a'],
    [pageB, 'lan_http_b'],
  ]) {
    page.on('pageerror', (error) => errors.push(error.message));
    const registered = await fetch(`${local}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        nickname: username,
        password: 'LanStudyTest42!',
        avatarId: 'lake',
      }),
    });
    assert.equal(registered.status, 201, await registered.text());
    await page.goto(`${base}/login`);
    assert.deepEqual(
      await page.evaluate(() => ({
        secure: isSecureContext,
        uuid: typeof crypto.randomUUID,
        random: typeof crypto.getRandomValues,
      })),
      { secure: false, uuid: 'undefined', random: 'function' },
    );
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill('LanStudyTest42!');
    await page.getByRole('button', { name: '登录 FocusSpace' }).click();
    await expect(page.getByRole('heading', { name: '创建自习房间' })).toBeVisible();
  }
  const requests = [];
  pageA.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${base}/api/rooms`)
      requests.push(request.postDataJSON().requestId);
  });
  await pageA.getByLabel('房间名称', { exact: true }).fill('局域网兼容验证');
  await pageA.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(pageA.getByText('实时连接正常', { exact: true })).toBeVisible();
  assert.match(
    requests[0],
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const code = await pageA.locator('.invite-code strong').innerText();
  assert.equal(await pageA.evaluate(() => typeof navigator.clipboard), 'undefined');
  await pageA.bringToFront();
  await pageA.locator('.invite-code').click();
  await expect(pageA.getByText('已复制房间码', { exact: true })).toBeVisible();
  await expect(pageA.getByRole('alert')).toHaveCount(0);
  await pageB.bringToFront();
  await pageB.getByLabel('房间码', { exact: true }).focus();
  await pageB.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await expect(pageB.getByLabel('房间码', { exact: true })).toHaveValue(code);
  // A browser refusal must not claim success; retry must clear the old error.
  await pageA.evaluate(() => {
    document.execCommand = () => false;
  });
  await pageA.bringToFront();
  await pageA.locator('.invite-code').click();
  await expect(pageA.getByRole('alert')).toContainText(`请手动复制房间码：${code}`);
  await expect(pageA.getByText('已复制房间码', { exact: true })).toHaveCount(0);
  assert.equal(await pageA.locator('textarea[tabindex="-1"]').count(), 0);
  await pageA.evaluate(() => {
    delete document.execCommand;
  });
  await pageA.locator('.invite-code').click();
  await expect(pageA.getByText('已复制房间码', { exact: true })).toBeVisible();
  await expect(pageA.getByRole('alert')).toHaveCount(0);
  await pageB.getByRole('button', { name: '加入房间', exact: true }).click();
  await expect(pageB.getByText('实时连接正常', { exact: true })).toBeVisible();
  await expect(pageA.getByText('2 人在线 / 8 个座位', { exact: true })).toBeVisible();
  await pageB.getByLabel('新任务', { exact: true }).fill('验证局域网任务');
  await pageB.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：验证局域网任务' })).toBeVisible();
  await pageB.reload();
  await expect(pageB.getByText('实时连接正常', { exact: true })).toBeVisible();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：验证局域网任务' })).toBeVisible();
  await pageA.getByRole('button', { name: '我准备好了', exact: true }).click();
  await pageB.getByRole('button', { name: '我准备好了', exact: true }).click();
  await expect(pageA.getByRole('button', { name: '开始共学', exact: true })).toBeEnabled();
  await pageA.getByRole('button', { name: '开始共学', exact: true }).click();
  await expect(pageA.getByRole('timer')).toBeVisible();
  await expect(pageB.getByRole('timer')).toBeVisible();
  await pageB.getByRole('checkbox', { name: '完成任务：验证局域网任务' }).click();
  await expect(pageB.getByRole('checkbox', { name: '完成任务：验证局域网任务' })).toBeChecked();
  await pageA.screenshot({ path: resolve(directory, 'lan-room.png'), fullPage: true });
  await pageA.getByRole('button', { name: '结束共学', exact: true }).click();
  await pageA.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(pageB.getByRole('heading', { name: '这次相聚先到这里' })).toBeVisible();
  assert.deepEqual(errors, []);
  const result = {
    base,
    secureContext: false,
    nativeRandomUUID: false,
    checks: [
      'create',
      'join',
      'HTTP copy and real paste',
      'copy refusal and retry',
      'two-user sync',
      'task add',
      'refresh recovery',
      'ready',
      'start',
      'task complete',
      'end',
    ],
    errors,
  };
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`PASS: HTTP LAN room workflow. Evidence: ${directory}`);
} catch (error) {
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages())
      console.error(page.url(), await page.locator('body').innerText());
  }
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  writeFileSync(resolve(directory, 'server.log'), log);
}
