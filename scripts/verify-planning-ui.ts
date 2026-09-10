import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/planning-ui-'));
const database = resolve(directory, 'ui.db');
const sqlite = new DatabaseSync(database);
for (const name of readdirSync('prisma/migrations')
  .filter((value) => value.startsWith('20'))
  .sort())
  sqlite.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
sqlite.close();

const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
await new Promise<void>((done) => listener.close(() => done()));
const base = `http://127.0.0.1:${address.port}`;
const env = {
  ...process.env,
  DATABASE_URL: `file:${database.replaceAll('\\', '/')}`,
  PORT: String(address.port),
  HOST: '127.0.0.1',
  APP_ORIGINS: base,
  COOKIE_SECURE: 'false',
};
let server: ChildProcess | undefined;
let log = '';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch(existsSync(edge) ? { executablePath: edge } : {});
try {
  server = spawn(process.execPath, ['apps/server/dist/index.js'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (chunk) => (log += chunk.toString()));
  server.stderr?.on('data', (chunk) => (log += chunk.toString()));
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (
      await fetch(`${base}/api/health`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const credentials = { username: 'planning_ui', nickname: '界面验证', password: 'PlanningUi42!' };
  let response = await page.request.post(`${base}/api/auth/register`, {
    headers: { Origin: base },
    data: credentials,
  });
  assert.equal(response.status(), 201);
  response = await page.request.post(`${base}/api/auth/login`, {
    headers: { Origin: base },
    data: { username: credentials.username, password: credentials.password },
  });
  assert.equal(response.status(), 200);

  await page.goto(`${base}/todos`);
  await expect(page.getByRole('heading', { name: '待办清单' })).toBeVisible();
  await expect(page.getByRole('link', { name: '数据统计' })).toBeVisible();
  await expect(page.getByRole('link', { name: '排行榜' })).toBeVisible();
  await page.getByPlaceholder('添加一项待办…').fill('完成 UI 验收');
  await page.getByRole('button', { name: '日期与更多' }).click();
  await page.getByLabel('截止日期').fill('2026-09-18');
  await page.getByLabel('标签').fill('产品, 验收');
  await page.getByLabel('重复').selectOption('WEEKLY');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.getByText('完成 UI 验收', { exact: true })).toBeVisible();
  await expect(page.getByText('↻ 每周')).toBeVisible();
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();

  await page.getByRole('link', { name: '数据统计' }).click();
  await expect(page.getByRole('heading', { name: '数据统计' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '专注趋势' })).toBeVisible();
  await page.getByRole('link', { name: '排行榜' }).click();
  await expect(page.getByRole('heading', { name: '排行榜' })).toBeVisible();

  await page.getByRole('link', { name: '共学首页' }).click();
  await page.getByRole('textbox', { name: '房间名称', exact: true }).fill('轮数与任务验证');
  await page.getByLabel('专注轮数').selectOption('infinite');
  await page.getByRole('button', { name: /创建房间/ }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.getByText(/无限循环/)).toBeVisible();
  await page.getByRole('button', { name: '从清单加入' }).click();
  const dialog = page.getByRole('dialog', { name: '选择待办加入房间' });
  await expect(dialog.getByText('完成 UI 验收')).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '加入 1 项' }).click();
  await expect(page.getByText('完成 UI 验收', { exact: true })).toBeVisible();
  await expect(page.getByText(/清单同步/)).toBeVisible();
  assert.deepEqual(errors, [], `browser errors: ${errors.join('\n')}`);
  console.log(
    'PASS navigation, todo calendar, analytics, leaderboard, infinite rounds and room todo picker UI',
  );
  await context.close();
} finally {
  await browser.close();
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  if (log.includes('Error')) console.error(log);
}
