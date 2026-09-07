import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
// One SQLite writer for this single-process MVP. This also serializes competing
// joins across rooms, preserving the one-active-room-per-user invariant.
let tail: Promise<unknown> = Promise.resolve();
export function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work);
  tail = next.catch(() => undefined);
  return next;
}
