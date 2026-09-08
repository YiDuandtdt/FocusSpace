import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const target = resolve(
  process.argv[2] ?? `backups/focusspace-${new Date().toISOString().replaceAll(':', '-')}.db`,
);
if (existsSync(target))
  throw new Error('Backup destination already exists; choose a new filename.');
mkdirSync(dirname(target), { recursive: true });
const db = new PrismaClient();
try {
  // SQLite creates a consistent standalone snapshot, including committed WAL data.
  await db.$executeRaw`VACUUM INTO ${target}`;
  console.log(`Database backup saved: ${target}`);
} finally {
  await db.$disconnect();
}
