import { taskCreateSchema, taskUpdateSchema, taskDeleteSchema } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { bump, receipt, requireMember } from './room.js';
import { advanceSession } from './session.js';
import { syncTodoCompletion } from './todo.js';

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
      let completion = false;
      if (type === 'task:create') {
        const input = taskCreateSchema.parse(payload);
        if ((await tx.task.count({ where: { sessionId: room.sessionId, userId } })) >= 100)
          throw new AppError('VALIDATION_ERROR', '本次共学最多设置 100 个任务', 400);
        if (input.parentTaskId) {
          const parent = await tx.task.findFirst({
            where: { id: input.parentTaskId, sessionId: room.sessionId, userId },
          });
          if (!parent) throw new AppError('NOT_FOUND', '上级任务不存在', 404);
        }
        let todo: {
          id: string;
          completed: boolean;
          completedAt: Date | null;
          labels: string;
          priority: string;
          dueAt: Date | null;
        } | null = null;
        if (input.todoId) {
          todo = await tx.todo.findFirst({ where: { id: input.todoId, userId, archivedAt: null } });
          if (!todo) throw new AppError('NOT_FOUND', '待办不存在', 404);
        }
        await tx.task.create({
          data: {
            sessionId: room.sessionId,
            userId,
            title: input.title,
            parentId: input.parentTaskId,
            todoId: todo?.id,
            completed: todo?.completed ?? false,
            completedAt: todo?.completedAt,
            priority: todo?.priority ?? input.priority,
            dueAt: todo?.dueAt ?? (input.dueAt ? new Date(input.dueAt) : null),
            labels: todo?.labels ?? JSON.stringify(input.labels),
          },
        });
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
        if (type === 'task:delete') {
          const all = await tx.task.findMany({
            where: { sessionId: room.sessionId, userId },
            select: { id: true, parentId: true },
          });
          const ids = [task.id];
          for (let cursor = 0; cursor < ids.length; cursor++)
            for (const child of all)
              if (child.parentId === ids[cursor] && !ids.includes(child.id)) ids.push(child.id);
          await tx.task.deleteMany({ where: { id: { in: ids } } });
        } else {
          const update = taskUpdateSchema.parse(payload);
          completion =
            update.completed === true && !task.completed && task.firstCompletedRound === null;
          await tx.task.update({
            where: { id: task.id, version: input.version },
            data: {
              title: update.title,
              visibility: update.visibility,
              priority: update.priority,
              dueAt:
                update.dueAt === undefined
                  ? undefined
                  : update.dueAt
                    ? new Date(update.dueAt)
                    : null,
              labels: update.labels === undefined ? undefined : JSON.stringify(update.labels),
              firstCompletedRound: completion ? room.session.roundNo : undefined,
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
          if (task.todoId && update.completed !== undefined)
            await syncTodoCompletion(tx, task.todoId, userId, update.completed);
        }
      }
      await bump(tx, roomId);
      return { roomId, completion };
    }),
  );
}
