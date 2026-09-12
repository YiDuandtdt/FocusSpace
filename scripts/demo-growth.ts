// Local-only, disposable demo. Intentionally ignores DATABASE_URL, HOST and PORT.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hash } from 'bcryptjs';
import { INITIAL_RULES } from '@focusspace/shared';
mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/growth-demo-'));
process.env.DATABASE_URL = `file:${resolve(directory, 'demo.db').replaceAll('\\', '/')}`;
process.env.HOST = '127.0.0.2';
process.env.PORT = '4319';
process.env.APP_ORIGINS = 'http://127.0.0.2:4319';
process.env.COOKIE_SECURE = 'false';
process.env.DEMO_MODE = 'true';
process.env.FOCUSSPACE_ISOLATED_DEMO = 'true';
const sql = new DatabaseSync(resolve(directory, 'demo.db'));
for (const migration of readdirSync('prisma/migrations')
  .filter((n) => n.startsWith('20'))
  .sort())
  sql.exec(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
sql.close();
const { db } = await import('../apps/server/src/db.js');
const { initGrowth } = await import('../apps/server/src/modules/growth.js');
const { finishSession } = await import('../apps/server/src/modules/session.js');
const password = randomBytes(12).toString('base64url'),
  passwordHash = await hash(password, 10);
for (const [username, role] of [
  ['growth_demo', 'USER'],
  ['growth_admin', 'ADMIN'],
] as const)
  await db.user.create({
    data: {
      id: username,
      username,
      nickname: role === 'ADMIN' ? '隔离演示管理员' : '隔离演示读者',
      passwordHash,
      role,
      onboarding: 'SKIPPED',
    },
  });
await initGrowth();
const at = new Date(Date.now() - 3600000);
await db.studySession.create({
  data: {
    id: 'demo-growth-study',
    phase: 'FOCUS',
    roundNo: 1,
    focusSeconds: 1500,
    breakSeconds: 300,
    startedAt: at,
    phaseStartAt: at,
    phaseEndAt: new Date(at.getTime() + 1500000),
    rewardRules: JSON.stringify(INITIAL_RULES),
    intervals: { create: { roundNo: 1, phase: 'FOCUS', startAt: at } },
    presence: { create: { userId: 'growth_demo', startAt: at } },
    tasks: {
      create: {
        userId: 'growth_demo',
        title: '演示：读完一节书并整理笔记',
        createdAt: new Date(at.getTime() - 1000),
        completed: true,
        completedAt: new Date(at.getTime() + 3300000),
      },
    },
    room: {
      create: {
        id: 'demo-growth-room',
        code: 'DEMO22',
        name: '隔离演示：一次学习的回响',
        ownerId: 'growth_demo',
        members: { create: { userId: 'growth_demo', seatIndex: 0, connectionState: 'CONNECTED' } },
      },
    },
  },
});
await db.$transaction((tx) =>
  finishSession(tx, 'demo-growth-room', 'OWNER_ENDED', new Date(at.getTime() + 3300000)),
);
await db.$disconnect();
const instructions = `隔离演示（不连接正式数据库）\n用户：http://127.0.0.2:4319/growth\n总结：http://127.0.0.2:4319/sessions/demo-growth-study/summary\n管理员：http://127.0.0.2:4319/admin/growth\n账号：growth_demo / growth_admin\n本次随机密码：${password}\n数据库：${directory}\nCtrl+C 停止。再次运行会创建全新演示，不影响正式账户。\n`;
writeFileSync(resolve(directory, 'access.txt'), instructions);
console.log(instructions);
await import('../apps/server/dist/index.js');
