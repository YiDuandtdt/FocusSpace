import { PrismaClient } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const url = process.env.DATABASE_URL;
if (!url?.startsWith('file:') || url.includes('?') || url === 'file::memory:')
  throw new Error(
    'DATABASE_URL must be a persistent SQLite file: path (without query parameters).',
  );
mkdirSync(dirname(resolve('prisma', url.slice(5))), { recursive: true });
// Materialize an empty SQLite file through Prisma before migrate deploy. This
// avoids the schema engine's empty-file initialization error on some Windows hosts.
const db = new PrismaClient();
try {
  await db.$connect();
} finally {
  await db.$disconnect();
}
