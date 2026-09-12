import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
const username = process.argv[2]?.trim().toLowerCase();
if (!username || !process.argv.includes('--confirm')) {
  console.error('Usage: npm run admin:init -- <existing-username> --confirm');
  process.exit(1);
}
// Explicit local maintenance only. Register a personal password through the normal UI first.
const db = new PrismaClient();
try {
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { username } });
    if (!user) throw new Error('账号不存在，请先通过注册页面创建自己的账号');
    if (user.bannedAt) throw new Error('账号已封禁，不能通过初始化绕过封禁');
    if (user.role === 'ADMIN') {
      console.log('账号已是管理员，无需重复初始化');
      return;
    }
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await tx.adminAudit.create({
      data: {
        actorId: 'LOCAL_OPERATOR',
        action: 'admin:initialize',
        targetId: user.id,
        reason: '显式本地命令初始化管理员',
        result: 'SUCCESS',
        summary: 'role: USER → ADMIN',
        requestId: randomUUID(),
      },
    });
    console.log('管理员初始化完成：' + username + '。重新登录后打开 /admin。');
  });
} finally {
  await db.$disconnect();
}
