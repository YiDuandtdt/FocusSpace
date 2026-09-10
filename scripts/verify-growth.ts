import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { hash } from 'bcryptjs';
import { chromium, expect } from '@playwright/test';
import { INITIAL_RULES, DEFAULT_CHARACTER, DEFAULT_SPACE } from '@focusspace/shared';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/growth-'));
process.env.DATABASE_URL = `file:${resolve(directory, 'test.db').replaceAll('\\', '/')}`;
const sql = new DatabaseSync(resolve(directory, 'test.db'));
const migrations = readdirSync('prisma/migrations')
  .filter((n) => n.startsWith('20'))
  .sort();
for (const name of migrations.filter((n) => !n.endsWith('_growth')))
  sql.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
sql.exec(`INSERT INTO User(id,username,passwordHash,nickname,characterConfig) VALUES('legacy','legacy','test','旧用户','${JSON.stringify({ ...DEFAULT_CHARACTER, outfit: 'outfit.lilac' })}');
INSERT INTO StudySession(id,phase,focusSeconds,breakSeconds,endedAt) VALUES('old','ENDED',1500,300,1725687600000);
INSERT INTO StudyRecord(id,sessionId,userId,focusSeconds,roundsCompleted,tasksDone,tasksTotal,studiedWith) VALUES('old-record','old','legacy',1500,1,1,1,0);`);
const before = sql.prepare('SELECT focusSeconds,roundsCompleted,tasksDone FROM StudyRecord').get();
sql.exec(readFileSync('prisma/migrations/202609090002_growth/migration.sql', 'utf8'));
assert.deepEqual(
  sql.prepare('SELECT focusSeconds,roundsCompleted,tasksDone FROM StudyRecord').get(),
  before,
);
assert.equal(
  sql.prepare("SELECT rewardState FROM StudyRecord WHERE id='old-record'").get()!.rewardState,
  'LEGACY',
);
sql.close();
const { db, serialize } = await import('../apps/server/src/db.js');
const growth = await import('../apps/server/src/modules/growth.js');
const { finishSession, recoverSessions } = await import('../apps/server/src/modules/session.js');
const { leaveMember, createRoom, snapshot } = await import('../apps/server/src/modules/room.js');
const { savePersonal, personalSpace } = await import('../apps/server/src/modules/personal.js');
const { retainData } = await import('../apps/server/src/modules/retention.js');
const { sendReaction } = await import('../apps/server/src/modules/reaction.js');
const password = 'GrowthDemo42!';
const passwordHash = await hash(password, 4);
for (const id of ['reader', 'friend', 'admin', 'poor'])
  await db.user.create({
    data: { id, username: id, nickname: id, passwordHash, role: id === 'admin' ? 'ADMIN' : 'USER' },
  });
await growth.initGrowth();
assert.equal((await growth.growthView('legacy')).coins, 0);
assert((await growth.growthView('legacy')).catalog.find((i) => i.id === 'outfit.lilac')!.owned);
assert((await growth.growthView('reader')).catalog.filter((i) => i.basic).every((i) => i.owned));
console.log('PASS additive migration, legacy exclusion, legacy equipment and basic grants');
let seq = 0;
async function fixture({
  user = 'reader',
  seconds = 1500,
  at = new Date('2026-09-09T15:45:00Z'),
  demo = false,
  rules = INITIAL_RULES,
  friend = true,
  goal = true,
}: {
  user?: string;
  seconds?: number;
  at?: Date;
  demo?: boolean;
  rules?: typeof INITIAL_RULES | null;
  friend?: boolean;
  goal?: boolean;
} = {}) {
  const n = ++seq,
    id = `session-${n}`,
    roomId = `room-${n}`,
    end = new Date(at.getTime() + seconds * 1000);
  await db.studySession.create({
    data: {
      id,
      phase: 'FOCUS',
      roundNo: 1,
      focusSeconds: demo ? 45 : 1500,
      breakSeconds: demo ? 15 : 300,
      startedAt: at,
      phaseStartAt: at,
      phaseEndAt: new Date(at.getTime() + (demo ? 45 : 1500) * 1000),
      rewardRules: rules ? JSON.stringify(rules) : null,
      intervals: { create: { roundNo: 1, phase: 'FOCUS', startAt: at } },
      room: {
        create: {
          id: roomId,
          code: `T${String(n).padStart(5, '2')}`,
          name: '隔离成长验证',
          ownerId: user,
          members: {
            create: [
              { userId: user, seatIndex: 0, connectionState: 'CONNECTED', lastSeenAt: at },
              ...(friend
                ? [
                    {
                      userId: 'friend',
                      seatIndex: 1,
                      connectionState: 'CONNECTED' as const,
                      lastSeenAt: at,
                    },
                  ]
                : []),
            ],
          },
        },
      },
    },
  });
  for (const userId of [user, ...(friend ? ['friend'] : [])])
    await db.presenceInterval.create({ data: { sessionId: id, userId, startAt: at } });
  // A duplicate tab overlaps completely and must never multiply effective time.
  await db.presenceInterval.create({
    data: { sessionId: id, userId: user, startAt: new Date(at.getTime() + 1000) },
  });
  if (goal)
    await db.task.create({
      data: {
        sessionId: id,
        userId: user,
        title: '先设学习目标',
        createdAt: new Date(at.getTime() - 1000),
        completed: true,
        completedAt: end,
      },
    });
  return { id, roomId, at, end };
}
const first = await fixture();
await db.$transaction((tx) => finishSession(tx, first.roomId, 'OWNER_ENDED', first.end));
let g = await growth.growthView('reader');
assert.equal(g.xp, 65);
assert.equal(g.coins, 31);
assert.equal(g.ledger.length, 1);
assert.equal(
  (await db.studyRecord.findFirstOrThrow({ where: { sessionId: first.id, userId: 'reader' } }))
    .focusSeconds,
  1500,
);
assert.equal(
  (await db.growthLedger.findFirstOrThrow({ where: { userId: 'reader' } })).rewardDay,
  '2026-09-10',
);
await Promise.all(
  Array.from({ length: 5 }, () =>
    serialize(() =>
      db.$transaction((tx) => finishSession(tx, first.roomId, 'OWNER_ENDED', first.end)),
    ),
  ),
);
await growth.compensateRewards();
assert.equal((await growth.growthView('reader')).coins, 31);
const second = await fixture();
await db.$transaction((tx) => finishSession(tx, second.roomId, 'ADMIN_ENDED', second.end));
g = await growth.growthView('reader');
assert.equal(g.xp, 120);
assert.equal(g.coins, 58);
assert.equal(g.level, 2);
console.log(
  'PASS server intervals, tab dedup, cross-midnight, daily bonus caps, complete rounds and duplicate end',
);
const old = await fixture({ rules: null });
await db.$transaction((tx) => finishSession(tx, old.roomId, 'OWNER_ENDED', old.end));
const demo = await fixture({ demo: true, seconds: 45 });
await db.$transaction((tx) => finishSession(tx, demo.roomId, 'OWNER_ENDED', demo.end));
assert.equal((await growth.growthView('reader')).coins, 58);
assert.equal(
  (await db.studyRecord.findFirstOrThrow({ where: { sessionId: demo.id, userId: 'reader' } }))
    .rewardState,
  'DEMO',
);
console.log('PASS old active sessions and demo sessions never award');
const early = await fixture({ user: 'poor', goal: false, at: new Date('2026-09-11T01:00:00Z') });
await db.$transaction((tx) =>
  leaveMember(tx, early.roomId, 'poor', 'TRANSFER_LEFT', new Date(early.at.getTime() + 300000)),
);
assert.equal((await db.room.findUniqueOrThrow({ where: { id: early.roomId } })).ownerId, 'friend');
await db.$transaction((tx) => finishSession(tx, early.roomId, 'ADMIN_ENDED', early.end));
assert.equal(
  (await db.studyRecord.findFirstOrThrow({ where: { sessionId: early.id, userId: 'poor' } }))
    .focusSeconds,
  300,
);
assert.equal((await growth.growthView('poor')).coins, 7);
console.log('PASS early leaving, owner succession and abnormal end retain valid study');
const acquisition = { assetId: 'outfit.clay', requestId: randomUUID() };
await Promise.all(
  Array.from({ length: 6 }, (_, n) =>
    serialize(() =>
      growth.acquire('reader', n < 3 ? acquisition : { ...acquisition, requestId: randomUUID() }),
    ),
  ),
);
assert.equal((await growth.growthView('reader')).coins, 53);
assert.equal(
  await db.growthLedger.count({
    where: { userId: 'reader', assetId: 'outfit.clay', source: 'REDEEM' },
  }),
  1,
);
await assert.rejects(() =>
  growth.acquire('poor', { assetId: 'room.arch', requestId: randomUUID() }),
);
await assert.rejects(() =>
  growth.acquire('poor', { assetId: 'accessory.glasses', requestId: randomUUID() }),
);
await db.$executeRawUnsafe(
  `CREATE TRIGGER fail_grant BEFORE INSERT ON OwnedAsset WHEN NEW.assetId='window.flowers' BEGIN SELECT RAISE(ABORT,'test grant failure'); END`,
);
await assert.rejects(() =>
  growth.acquire('reader', { assetId: 'window.flowers', requestId: randomUUID() }),
);
assert.equal((await growth.growthView('reader')).coins, 53);
assert.equal(
  await db.growthLedger.count({ where: { userId: 'reader', assetId: 'window.flowers' } }),
  0,
);
await db.$executeRawUnsafe('DROP TRIGGER fail_grant');
await growth.acquire('reader', { assetId: 'motion.stretch', requestId: randomUUID() });
await growth.equip('reader', { assetId: 'motion.stretch', requestId: randomUUID() });
await growth.equip('reader', { assetId: 'outfit.clay', requestId: randomUUID() });
await assert.rejects(() =>
  growth.equip('poor', { assetId: 'outfit.clay', requestId: randomUUID() }),
);
const poorSpace = await personalSpace('poor');
await assert.rejects(() =>
  savePersonal('poor', {
    ...poorSpace,
    character: { ...poorSpace.character, outfit: 'outfit.clay' },
  }),
);
await assert.rejects(() =>
  savePersonal('poor', {
    revision: poorSpace.revision,
    character: { ...poorSpace.character, outfit: 'outfit.clay' },
    space: poorSpace.space,
  }),
);
console.log(
  'PASS concurrent purchase, insufficient funds, grant failure rollback, ownership, level and direct equipment validation',
);
const itemAction = {
  action: 'item',
  assetId: 'outfit.clay',
  price: 5,
  minLevel: 1,
  status: 'DELISTED',
  reason: '验证普通下架保留已有资产',
  requestId: randomUUID(),
};
await growth.growthAdmin('admin', itemAction);
await growth.equip('reader', { assetId: 'outfit.clay', requestId: randomUUID() });
await assert.rejects(() =>
  growth.acquire('poor', { assetId: 'outfit.clay', requestId: randomUUID() }),
);
await growth.growthAdmin('admin', { ...itemAction, status: 'DISABLED', requestId: randomUUID() });
assert.equal((await personalSpace('reader')).character.outfit, 'outfit.sage');
await assert.rejects(() =>
  growth.growthAdmin('admin', { ...itemAction, assetId: 'outfit.sage', requestId: randomUUID() }),
);
await assert.rejects(() => growth.growthAdmin('poor', { ...itemAction, requestId: randomUUID() }));
await growth.growthAdmin('admin', { ...itemAction, status: 'ACTIVE', requestId: randomUUID() });
const comp = {
  action: 'compensate',
  userId: 'reader',
  xp: 0,
  coins: 2,
  reason: '验证幂等补偿流水',
  requestId: randomUUID(),
};
await growth.growthAdmin('admin', comp);
await growth.growthAdmin('admin', comp);
assert.equal((await growth.growthView('reader')).coins, 55);
assert.equal(await db.adminAudit.count({ where: { requestId: comp.requestId } }), 1);
assert.equal(await db.growthLedger.count({ where: { key: `admin:admin:${comp.requestId}` } }), 1);
await assert.rejects(() =>
  growth.growthAdmin('admin', { ...comp, reason: '', requestId: randomUUID() }),
);
await assert.rejects(() =>
  growth.growthAdmin('admin', { ...comp, coins: -1000, requestId: randomUUID() }),
);
await db.commandReceipt.updateMany({
  where: { requestId: comp.requestId },
  data: { createdAt: new Date('2020-01-01') },
});
await retainData();
await growth.growthAdmin('admin', comp);
assert.equal((await growth.growthView('reader')).coins, 55);
console.log(
  'PASS admin authorization, mandatory reason, audit atomicity, retained idempotency, delist and disabled fallback',
);
await growth.growthAdmin('admin', {
  action: 'rules',
  rules: { ...INITIAL_RULES, xpPerMinute: 3 },
  reason: '验证仅新建场次使用新规则',
  requestId: randomUUID(),
});
const newRoom = await createRoom('reader', {
  name: '规则快照验证',
  focusSeconds: 1500,
  breakSeconds: 300,
  requestId: randomUUID(),
});
assert.equal(
  JSON.parse(
    (await db.studySession.findUniqueOrThrow({ where: { id: newRoom.sessionId } })).rewardRules!,
  ).version,
  2,
);
assert.equal(
  JSON.parse((await db.studySession.findUniqueOrThrow({ where: { id: first.id } })).rewardRules!)
    .xpPerMinute,
  2,
);
const originalSnapshot = (await db.room.findUniqueOrThrow({ where: { id: newRoom.roomId } }))
  .spaceSnapshot;
await growth.acquire('reader', { assetId: 'desk.walnut', requestId: randomUUID() });
await growth.equip('reader', { assetId: 'desk.walnut', requestId: randomUUID() });
assert.equal(
  (await db.room.findUniqueOrThrow({ where: { id: newRoom.roomId } })).spaceSnapshot,
  originalSnapshot,
);
await db.$transaction((tx) => finishSession(tx, newRoom.roomId, 'OWNER_ENDED'));
await assert.rejects(() => sendReaction('poor', early.roomId, randomUUID(), { symbol: '✨' }));
console.log('PASS rule snapshot, frozen room layout and locked interaction');
// Force a ledger insert failure: end/record/account all roll back and can be retried.
const failed = await fixture({
  user: 'poor',
  friend: false,
  goal: false,
  seconds: 300,
  at: new Date('2026-09-12T01:00:00Z'),
});
await db.$executeRawUnsafe(
  `CREATE TRIGGER fail_award BEFORE INSERT ON GrowthLedger WHEN NEW.source='STUDY' BEGIN SELECT RAISE(ABORT,'test award failure'); END`,
);
await assert.rejects(() =>
  db.$transaction((tx) => finishSession(tx, failed.roomId, 'OWNER_ENDED', failed.end)),
);
assert.equal(
  (await db.studySession.findUniqueOrThrow({ where: { id: failed.id } })).phase,
  'FOCUS',
);
assert.equal(await db.studyRecord.count({ where: { sessionId: failed.id } }), 0);
await db.$executeRawUnsafe('DROP TRIGGER fail_award');
await db.$transaction((tx) => finishSession(tx, failed.roomId, 'OWNER_ENDED', failed.end));
const beforeRestart = (await growth.growthView('poor')).coins;
// Persist a known pending record to test process restart compensation, not a historical scan.
const pendingSession = await db.studySession.create({
  data: {
    phase: 'ENDED',
    focusSeconds: 1500,
    breakSeconds: 300,
    rewardRules: JSON.stringify(INITIAL_RULES),
    endedAt: new Date(),
    records: {
      create: {
        userId: 'poor',
        focusSeconds: 60,
        roundsCompleted: 0,
        tasksDone: 0,
        tasksTotal: 0,
        studiedWith: 0,
        rewardState: 'PENDING',
        settledAt: new Date(),
        rewardFacts: '{"goal":false,"togetherSeconds":0}',
      },
    },
  },
});
const disconnected = await fixture({
  user: 'poor',
  friend: false,
  goal: false,
  at: new Date(Date.now() - 600000),
});
await db.roomMember.updateMany({
  where: { roomId: disconnected.roomId },
  data: { lastSeenAt: new Date(disconnected.at.getTime() + 60000) },
});
await recoverSessions(new Date());
await recoverSessions(new Date(Date.now() + 120000));
const recovered = await db.studyRecord.findFirstOrThrow({
  where: { sessionId: disconnected.id, userId: 'poor' },
});
assert.equal(recovered.focusSeconds, 60);
console.log('PASS award rollback and restart heartbeat truncation');
await db.$disconnect();

const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
assert(address && typeof address === 'object');
await new Promise<void>((r) => listener.close(() => r()));
const base = `http://127.0.0.1:${address.port}`;
let server: ChildProcess | undefined;
let log = '';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function boot() {
  server = spawn(process.execPath, ['apps/server/dist/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(address.port),
      APP_ORIGINS: base,
      COOKIE_SECURE: 'false',
      DEMO_MODE: 'true',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  for (let n = 0; n < 100; n++) {
    if (
      await fetch(`${base}/api/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(log);
}
async function req(path: string, cookie = '', body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function login(username: string) {
  const r = await req('/auth/login', '', { username, password });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie')!.split(';')[0];
}
try {
  await boot();
  const readerCookie = await login('reader'),
    adminCookie = await login('admin'),
    poorCookie = await login('poor');
  assert.equal((await req('/admin/growth', readerCookie)).status, 403);
  assert.equal((await req('/admin/growth')).status, 401);
  assert.equal((await req('/admin/growth', readerCookie, comp)).status, 403);
  assert.equal(
    (
      await req('/users/me/growth/acquire', readerCookie, {
        assetId: 'outfit.blue',
        requestId: randomUUID(),
        coins: 999,
      })
    ).status,
    400,
  );
  assert.equal((await req('/users/me/sounds/stream', poorCookie)).status, 403);
  assert.equal((await req('/users/me/sounds/birds', poorCookie)).status, 200);
  const poor = await (await req('/users/me/growth', poorCookie)).json();
  assert.equal(poor.coins, beforeRestart + 2);
  assert.equal(
    (await db.studyRecord.findFirstOrThrow({ where: { sessionId: pendingSession.id } }))
      .rewardState,
    'POSTED',
  );
  await db.studyRecord.updateMany({
    where: { sessionId: pendingSession.id },
    data: { rewardState: 'PENDING' },
  });
  await growth.compensateRewards('poor');
  assert.equal((await growth.growthView('poor')).coins, poor.coins);
  console.log(
    'PASS process startup compensation, replay with existing ledger, HTTP authorization and untrusted amounts',
  );
  browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: 'focusspace_session', value: readerCookie.split('=')[1], url: base },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/growth`);
  await expect(page.getByRole('heading', { name: '成长与装扮', exact: true })).toBeVisible();
  await expect(page.locator('.growth-items .growth-item').first()).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.locator('.growth-item').filter({ hasText: '一束小花' }).click();
  await page.getByRole('button', { name: '兑换 · 5 币', exact: true }).click();
  await expect(page.getByText('已永久拥有。点击「使用」保存到个人空间。')).toBeVisible();
  await page.getByRole('button', { name: '使用', exact: true }).click();
  await expect(
    page.getByText('已使用。空间布置用于下一次共学，当前房间保留原快照。'),
  ).toBeVisible();
  mkdirSync('Doc/screenshots/growth', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'Doc/screenshots/growth/01-growth-desktop.png', fullPage: true });
  await page.goto(`${base}/sessions/${first.id}/summary`);
  await expect(page.getByText('本次奖励 · 已到账')).toBeVisible();
  await page.screenshot({ path: 'Doc/screenshots/growth/02-reward-summary.png', fullPage: true });
  await page.goto(`${base}/space`);
  await expect(page.getByRole('heading', { name: '我的个人空间', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/growth`);
  await expect(page.locator('.growth-items .growth-item').first()).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: 'Doc/screenshots/growth/03-growth-mobile.png', fullPage: true });
  await context.addCookies([
    { name: 'focusspace_session', value: adminCookie.split('=')[1], url: base },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/admin/growth`);
  await expect(page.getByRole('heading', { name: '成长与资产管理' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存物品配置' })).toBeVisible();
  await page.screenshot({ path: 'Doc/screenshots/growth/04-admin.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS browser redemption/equip, Summary, personal page, mobile overflow and admin entry',
  );
  writeFileSync(
    'Doc/screenshots/growth/verification.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        isolatedDatabase: directory,
        result: 'PASS',
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  await db.$disconnect();
}
console.log('Growth verification complete. All data isolated in ' + directory);
