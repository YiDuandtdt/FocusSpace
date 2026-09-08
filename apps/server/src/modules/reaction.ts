import { z } from 'zod';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { receipt, requireMember } from './room.js';
import type { LightEvent } from '@focusspace/shared';
export async function sendReaction(
  userId: string,
  roomId: string,
  requestId: string,
  payload: unknown,
): Promise<LightEvent> {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, 'reaction:send', { roomId, payload }, async () => {
      const { symbol } = z
        .object({ symbol: z.enum(['🌱', '💪', '☕']) })
        .strict()
        .parse(payload);
      const { room, member } = await requireMember(roomId, userId, tx);
      if (
        !['FOCUS', 'BREAK'].includes(room.session.phase) ||
        member.connectionState !== 'CONNECTED'
      )
        throw new AppError('INVALID_PHASE', '开始共学并恢复连接后可以鼓励搭子', 409);
      const previous = await tx.commandReceipt.findFirst({
        where: {
          userId,
          commandType: 'reaction:send',
          createdAt: { gt: new Date(Date.now() - 10000) },
        },
      });
      if (previous) throw new AppError('RATE_LIMITED', '鼓励每 10 秒一次，安静陪伴就好', 429);
      return {
        eventId: requestId,
        roomId,
        sessionId: room.sessionId,
        userId,
        symbol,
        createdAt: Date.now(),
      };
    }),
  );
}
