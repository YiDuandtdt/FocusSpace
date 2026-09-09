import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import { io } from 'socket.io-client';
import type { Ack } from '@focusspace/shared';

// Every account, room and moderation action belongs to a disposable database.
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/ui-'));
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
  COOKIE_SECURE: 'false',
  DEMO_MODE: 'true',
  DISCONNECT_GRACE_MS: '60000',
  NODE_ENV: 'production',
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
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d;
});
server.stderr.on('data', (d) => {
  serverLog += d;
});
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(edge) ? { executablePath: edge } : {}),
});
const failures: string[] = [];
const checks: string[] = [];
const contexts: BrowserContext[] = [];
const sockets: ReturnType<typeof io>[] = [];
async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  ctx.on('page', (p) => p.on('pageerror', (e) => failures.push(e.message)));
  contexts.push(ctx);
  return ctx;
}
async function request(ctx: BrowserContext, path: string, body?: object) {
  const response = body
    ? await ctx.request.post(base + '/api' + path, { data: body, headers: { Origin: base } })
    : await ctx.request.get(base + '/api' + path);
  assert(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function actor(username: string, nickname: string) {
  const ctx = await context();
  const body = { username, nickname, password: 'StudyTogether42!', avatarId: 'sage' };
  const result = await request(ctx, '/auth/register', body);
  await request(ctx, '/auth/login', body);
  return { ctx, id: result.user.id as string };
}
async function capture(page: Page, name: string, widths = [1440, 768, 390, 320]) {
  await page.bringToFront();
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => document.fonts.ready);
    // Offscreen 3D rendering intentionally sleeps; bring it into view after a resize.
    const scene = page.locator('.scene-host:visible');
    if (await scene.count()) {
      await scene.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      await expect
        .poll(
          async () =>
            scene.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
              const probe = document.createElement('canvas');
              probe.width = probe.height = 32;
              const ctx = probe.getContext('2d')!;
              ctx.drawImage(canvas, 0, 0, 32, 32);
              const pixels = ctx.getImageData(0, 0, 32, 32).data;
              const colors = new Set<string>();
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] > 0) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
              }
              return colors.size;
            }),
          { message: `${name} ${width}px: 3D canvas contains rendered furniture`, timeout: 10000 },
        )
        .toBeGreaterThan(20);
    }
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return {
        width,
        scroll: document.documentElement.scrollWidth,
        nodes: Array.from(document.querySelectorAll('main *'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width && r.right > width + 2 && !e.closest('.admin-table-wrap, .scene-host');
          })
          .slice(0, 5)
          .map((e) => e.className || e.tagName),
      };
    });
    assert(
      overflow.scroll <= overflow.width + 2,
      `${name} @ ${width}: ${JSON.stringify(overflow)}`,
    );
    // Keep canvas evidence separate: full-page capture can resize the viewport and clear
    // an idle WebGL drawing buffer when reduced motion is enabled.
    if (await scene.count())
      await scene.screenshot({ path: resolve(directory, `${name}-${width}-scene.png`) });
    await page.screenshot({ path: resolve(directory, `${name}-${width}.png`), fullPage: true });
  }
  checks.push(`${name}: ${widths.join('/')}px, no document overflow`);
  console.log(checks.at(-1));
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await expect
    .poll(
      async () =>
        fetch(base + '/api/health')
          .then((r) => r.ok)
          .catch(() => false),
      { timeout: 15000 },
    )
    .toBe(true);
  const anonymous = await context();
  const login = await anonymous.newPage();
  await login.goto(base + '/login');
  await expect(login.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await login.getByLabel('密码', { exact: true }).fill('StudyTogether42!');
  await login.getByRole('button', { name: '显示密码' }).click();
  await expect(login.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await login.getByRole('button', { name: '隐藏密码' }).click();
  await capture(login, 'login');
  await login.getByRole('link', { name: '注册账号' }).click();
  await expect(login.getByRole('heading', { name: '认识一下，学习搭子' })).toBeVisible();
  await capture(login, 'register');
  await login.getByLabel('账号', { exact: true }).fill('ui_registered');
  await login.getByLabel('昵称', { exact: true }).fill('安静读书的人');
  await login.getByLabel('密码', { exact: true }).fill('StudyTogether42!');
  await login.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(login.getByText('注册成功，请使用新账号登录。')).toBeVisible();
  await login.getByLabel('账号', { exact: true }).fill('ui_registered');
  await login.getByLabel('密码', { exact: true }).fill('StudyTogether42!');
  await login.getByRole('button', { name: '登录 FocusSpace' }).click();
  await expect(login.getByRole('heading', { name: '创建自习房间' })).toBeVisible();
  await capture(login, 'home-empty');
  await login.locator('.public-directory').getByLabel('房间名称').fill('找不到的房间');
  await login.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(login).toHaveURL(/rooms_q=/);
  await login.reload();
  await expect(login.locator('.public-directory').getByLabel('房间名称')).toHaveValue(
    '找不到的房间',
  );
  await login.getByRole('button', { name: '清除筛选' }).click();
  await expect(login.locator('.public-directory').getByLabel('房间名称')).toHaveValue('');
  await login.getByRole('link', { name: '学习历史', exact: true }).click();
  await expect(login.getByRole('heading', { level: 1, name: '我的学习历史' })).toBeVisible();
  await capture(login, 'history-empty');
  await login.getByRole('button', { name: '编辑个人资料：安静读书的人' }).click();
  await expect(login.getByRole('dialog')).toBeVisible();
  await capture(login, 'profile', [390]);
  await login.keyboard.press('Escape');
  await expect(login.getByRole('dialog')).toHaveCount(0);

  const owner = await actor('ui_owner', '一起读书的同学');
  const guest = await actor('ui_guest', '今天也在认真学习的伙伴');
  const admin = await actor('ui_admin', '共学空间管理员');
  await database.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  const page = await owner.ctx.newPage();
  await page.goto(base);
  await page
    .locator('.create-panel')
    .getByLabel('房间名称')
    .fill('窗边共读 · 把今天的一小步写进书里');
  await page.getByLabel('房间可见性').selectOption('PUBLIC');
  await page.getByRole('button', { name: '创建房间', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const roomId = new URL(page.url()).pathname.split('/')[2];
  await expect(page.getByText('实时连接正常', { exact: true })).toBeVisible();
  const snapshot = await request(owner.ctx, `/rooms/${roomId}/snapshot`);
  const cookies = await owner.ctx.cookies();
  const socket = io(base, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), Origin: base },
  });
  sockets.push(socket);
  await once(socket, 'connect');
  async function command(type: string, payload = {}) {
    const ack: Ack = await socket
      .timeout(8000)
      .emitWithAck(type, { roomId, payload, requestId: crypto.randomUUID() });
    assert(ack.ok, JSON.stringify(ack.error));
    return ack;
  }
  await command('room:join');
  const invite = await guest.ctx.newPage();
  await invite.goto(base + '/join/' + snapshot.room.code);
  await expect(invite.getByRole('button', { name: '加入邀请房间' })).toBeVisible();
  await capture(invite, 'invite');
  await invite.getByRole('button', { name: '加入邀请房间' }).click();
  await expect(invite.getByText('实时连接正常', { exact: true })).toBeVisible();
  await page
    .getByLabel('新任务', { exact: true })
    .fill('读完第三章，整理关键概念与错题，然后写下仍然不理解的地方。'.repeat(3));
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page
    .locator('.task-row')
    .getByRole('button', { name: /^编辑任务/ })
    .click();
  await page.getByLabel('编辑任务标题').fill('整理第三章笔记，并完成课后练习');
  await page.locator('.task-edit').getByRole('button', { name: '保存', exact: true }).click();
  await page
    .locator('.task-row')
    .getByRole('button', { name: /^删除任务/ })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture(page, 'delete-confirm', [390]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.getByRole('button', { name: /^房间码/ }).click();
  await expect(page.locator('.notice-success')).toContainText('房间码已复制');
  await capture(page, 'lobby');
  await page.getByRole('button', { name: '使用座位卡片' }).click();
  await capture(page, 'seat-cards', [390]);
  await page.getByRole('button', { name: '打开 3D 空间' }).click();
  await command('room:configure', { focusSeconds: 45, breakSeconds: 15 });
  await page.getByRole('button', { name: '我准备好了' }).click();
  await invite.getByRole('button', { name: '我准备好了' }).click();
  await expect(page.getByRole('button', { name: '开始共学', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '开始共学', exact: true }).click();
  await expect(page.locator('.phase-FOCUS')).toBeVisible();
  await page.locator('.task-row').getByRole('checkbox').click();
  await expect(page.locator('.task-row').getByRole('checkbox')).toBeChecked();
  await capture(page, 'focus');
  await page.getByRole('button', { name: '专注视图', exact: true }).click();
  await capture(page, 'focus-view', [1440, 390]);
  await expect(page.locator('#room-chat')).toBeHidden();
  await expect(page.locator('.phase-BREAK')).toBeVisible({ timeout: 55000 });
  await expect(page.locator('#room-chat')).toBeVisible();
  await page.getByLabel('休息消息', { exact: true }).fill('这一轮整理好了笔记，休息一下。');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(invite.getByRole('log')).toContainText('这一轮整理好了笔记');
  await capture(page, 'break-view', [390, 1440]);
  await page.getByRole('button', { name: '结束共学', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这次相聚先到这里' })).toBeVisible();
  await page.getByRole('link', { name: '打开已保存结果' }).click();
  await capture(page, 'summary');
  await page.getByRole('link', { name: '查看学习历史', exact: true }).click();
  await expect(page.locator('.history-list li')).toHaveCount(1);
  await capture(page, 'history');
  await page.goto(base + '/rooms/unavailable');
  await expect(page.getByRole('link', { name: '返回首页', exact: true })).toBeVisible();
  await capture(page, 'room-unavailable', [390]);
  await page.goto(base + '/does-not-exist');
  await expect(page.getByRole('heading', { name: '这里还没有座位' })).toBeVisible();
  await capture(page, 'not-found', [390]);
  const management = await admin.ctx.newPage();
  for (const [tab, label] of [
    ['overview', '管理概览'],
    ['users', '用户管理'],
    ['rooms', '房间与 Session'],
    ['messages', '有限期消息'],
    ['audits', '操作审计'],
  ]) {
    await management.goto(base + `/admin?tab=${tab}`);
    await expect(management.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(management.getByText('正在读取管理数据…')).toHaveCount(0);
    await capture(management, `admin-${tab}`);
  }
  await management.goto(base + '/admin?tab=users&q=ui_registered');
  await expect(management.locator('tbody tr')).toHaveCount(1);
  await management.getByRole('button', { name: '封禁', exact: true }).click();
  await expect(management.getByRole('dialog')).toBeVisible();
  await capture(management, 'admin-confirm', [390]);
  await management.keyboard.press('Escape');
  await expect(management.getByRole('dialog')).toHaveCount(0);
  await management.reload();
  await expect(management.getByRole('link', { name: '用户管理', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(management.getByLabel('搜索账号或昵称')).toHaveValue('ui_registered');
  await login.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(login.getByRole('dialog')).toBeVisible();
  await capture(login, 'logout-confirm', [390]);
  await login.keyboard.press('Escape');
  await expect(login.getByRole('button', { name: '退出登录', exact: true })).toBeFocused();
  assert.deepEqual(failures, [], 'Browser errors');
  checks.push(
    'Registration/login, URL filters, profile/Escape, create/invite, task edit/delete cancel, copy feedback, shared focus/break chat, summary/history, admin preview, and dialog focus restoration passed.',
  );
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ checks, failures }, null, 2));
  console.log('UI verification passed. Screenshots and report: ' + directory);
} catch (error) {
  console.error('UI verification failed. Artifacts: ' + directory);
  console.error(serverLog);
  throw error;
} finally {
  sockets.forEach((s) => s.disconnect());
  await Promise.all(contexts.map((c) => c.close()));
  await browser.close();
  server.kill();
  await database.$disconnect();
}
