import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;
export async function openPresence(tx: Tx, sessionId: string, userId: string, at: Date) {
  const open = await tx.presenceInterval.findFirst({ where: { sessionId, userId, endAt: null } });
  if (!open) await tx.presenceInterval.create({ data: { sessionId, userId, startAt: at } });
}
export async function closePresence(
  tx: Tx,
  sessionId: string,
  userId: string,
  at: Date,
  reason: string,
) {
  const open = await tx.presenceInterval.findMany({ where: { sessionId, userId, endAt: null } });
  for (const interval of open)
    await tx.presenceInterval.update({
      where: { id: interval.id },
      data: {
        endAt: new Date(Math.max(interval.startAt.getTime(), at.getTime())),
        endReason: reason,
      },
    });
}
