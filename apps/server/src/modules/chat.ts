import { chatSendSchema, type ChatMessage } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { bump, receipt, requireMember } from './room.js';
import { advanceSession } from './session.js';

export async function sendChat(
  userId: string,
  roomId: string,
  requestId: string,
  payload: unknown,
): Promise<ChatMessage> {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, 'chat:send', { roomId, payload }, async () => {
      const { content } = chatSendSchema.parse(payload);
      await advanceSession(tx, roomId);
      const { room, member } = await requireMember(roomId, userId, tx);
      if (room.session.phase !== 'BREAK')
        throw new AppError('INVALID_PHASE', '休息时间开放聊天', 409);
      if (member.connectionState !== 'CONNECTED')
        throw new AppError('FORBIDDEN', '请先恢复房间连接', 403);
      const previous = await tx.chatMessage.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      const now = new Date();
      if (previous && now.getTime() - previous.createdAt.getTime() < 2000)
        throw new AppError('RATE_LIMITED', '每 2 秒可以发送一条消息，请稍后再试', 429);
      const message = await tx.chatMessage.create({
        data: { roomId, sessionId: room.sessionId, userId, content, requestId, createdAt: now },
      });
      await bump(tx, roomId);
      return {
        id: message.id,
        userId,
        nickname: member.user.nickname,
        content,
        createdAt: now.getTime(),
      };
    }),
  );
}
