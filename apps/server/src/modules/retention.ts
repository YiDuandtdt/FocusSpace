import { db } from '../db.js';

export async function retainData(at = new Date()) {
  const chatCutoff = new Date(at.getTime() - 86400000);
  const receiptCutoff = new Date(at.getTime() - 7 * 86400000);
  return db.$transaction(async (tx) => {
    await tx.chatMessage.deleteMany({ where: { createdAt: { lt: chatCutoff } } });
    // Receipts also contain chat text. Keep a tombstone so replay cannot recreate an expired message.
    await tx.commandReceipt.updateMany({
      where: {
        commandType: 'chat:send',
        createdAt: { lt: chatCutoff },
        result: { not: '{"expired":true}' },
      },
      data: { result: '{"expired":true}' },
    });
    const active = await tx.room.findMany({
      where: {
        session: { OR: [{ phase: { not: 'ENDED' } }, { endedAt: { gte: receiptCutoff } }] },
      },
      select: { id: true },
    });
    await tx.commandReceipt.deleteMany({
      where: {
        createdAt: { lt: receiptCutoff },
        NOT: { commandType: { startsWith: 'growth:' } },
        OR: [{ roomId: null }, { roomId: { notIn: active.map((room) => room.id) } }],
      },
    });
    await tx.authSession.deleteMany({ where: { expiresAt: { lt: at } } });
  });
}
