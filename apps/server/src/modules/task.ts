import { taskCreateSchema, taskUpdateSchema, taskDeleteSchema } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { bump, receipt, requireMember } from './room.js';
import { advanceSession } from './session.js';

export async function taskCommand(
  userId: string,
  roomId: string,
  requestId: string,
  type: string,
  payload: unknown,
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, type, { roomId, payload }, async () => {
      await advanceSession(tx, roomId);
      const { room, member } = await requireMember(roomId, userId, tx);
      if (room.session.phase === 'ENDED')
        throw new AppError('ROOM_ENDED', '共学已结束，任务已冻结', 409);
      if (member.connectionState !== 'CONNECTED')
        throw new AppError('CONFLICT', '请等待连接恢复', 409);
      if (type === 'task:create') {
        const input = taskCreateSchema.parse(payload);
        if ((await tx.task.count({ where: { sessionId: room.sessionId, userId } })) >= 100)
          throw new AppError('VALIDATION_ERROR', '本次共学最多设置 100 个任务', 400);
        await tx.task.create({ data: { sessionId: room.sessionId, userId, title: input.title } });
      } else {
        const input =
          type === 'task:delete'
            ? taskDeleteSchema.parse(payload)
            : taskUpdateSchema.parse(payload);
        const task = await tx.task.findFirst({
          where: { id: input.taskId, sessionId: room.sessionId, userId },
        });
        if (!task) throw new AppError('NOT_FOUND', '任务不存在', 404);
        if (task.version !== input.version)
          throw new AppError('CONFLICT', '任务已在另一标签页更新，请根据最新内容重试', 409);
        if (type === 'task:delete')
          await tx.task.delete({ where: { id: task.id, version: input.version } });
        else {
          const update = taskUpdateSchema.parse(payload);
          await tx.task.update({
            where: { id: task.id, version: input.version },
            data: {
              title: update.title,
              completed: update.completed,
              version: { increment: 1 },
              completedAt:
                update.completed === undefined
                  ? undefined
                  : update.completed
                    ? (task.completedAt ?? new Date())
                    : null,
            },
          });
        }
      }
      await bump(tx, roomId);
      return { roomId };
    }),
  );
}
