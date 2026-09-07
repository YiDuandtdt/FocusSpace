import { PrismaClient } from '@prisma/client';
// Materialize an empty SQLite file through Prisma before migrate deploy. This
// avoids the schema engine's empty-file initialization error on some Windows hosts.
const db = new PrismaClient();
try {
  await db.$connect();
} finally {
  await db.$disconnect();
}
