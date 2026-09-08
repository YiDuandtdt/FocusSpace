import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

if (process.env.DEMO_MODE !== 'true')
  throw new Error('Set DEMO_MODE=true in .env before explicitly initializing demo accounts.');
const prefix = process.argv[2] ?? 'focus_demo';
if (!/^[a-z][a-z0-9_]{2,19}$/.test(prefix))
  throw new Error(
    'Prefix must be 3–20 lowercase letters, digits or underscores, starting with a letter.',
  );
const db = new PrismaClient();
try {
  for (const [index, avatarId] of ['lake', 'sage', 'lilac'].entries()) {
    const username = `${prefix}_${index + 1}`;
    if (await db.user.findUnique({ where: { username } })) {
      console.log(
        `${username}: already exists; unchanged. Use a new prefix if you need new credentials.`,
      );
      continue;
    }
    const password = randomBytes(18).toString('base64url');
    const passwordHash = await hash(password, 12);
    await db.user.create({
      data: { username, nickname: `学习搭子 ${index + 1}`, avatarId, passwordHash, role: 'USER' },
    });
    console.log(`${username}  ${password}`);
  }
  console.log(
    'New passwords are shown only here. Save them privately. No rooms or records were modified.',
  );
} finally {
  await db.$disconnect();
}
