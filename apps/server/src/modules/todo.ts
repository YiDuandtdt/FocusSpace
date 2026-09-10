import type { Prisma, Todo as TodoRow } from '@prisma/client';
import {
  todoCreateSchema,
  todoUpdateSchema,
  todoRoomSchema,
  type Todo as TodoView,
} from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { bump, receipt, requireMember } from './room.js';

type Tx = Prisma.TransactionClient;
const parseLabels = (value: string) => {
  try {
    const labels = JSON.parse(value);
    return Array.isArray(labels)
      ? labels.filter((label): label is string => typeof label === 'string')
      : [];
  } catch {
    return [];
  }
};
const date = (value?: string | null) =>
  value === undefined ? undefined : value ? new Date(value) : null;

function view(
  item: {
    id: string;
    parentId: string | null;
    title: string;
    completed: boolean;
    completedAt: Date | null;
    priority: string;
    dueAt: Date | null;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    labels: string;
    recurrence: string;
    version: number;
  },
  linkedRoomId: string | null,
  children: TodoView[] = [],
): TodoView {
  return {
    id: item.id,
    parentId: item.parentId,
    title: item.title,
    completed: item.completed,
    completedAt: item.completedAt?.getTime() ?? null,
    priority: item.priority as TodoView['priority'],
    dueAt: item.dueAt?.getTime() ?? null,
    scheduledStart: item.scheduledStart?.getTime() ?? null,
    scheduledEnd: item.scheduledEnd?.getTime() ?? null,
    labels: parseLabels(item.labels),
    recurrence: item.recurrence as TodoView['recurrence'],
    version: item.version,
    linkedRoomId,
    children,
  };
}

export async function todos(userId: string): Promise<TodoView[]> {
  const [items, active] = await Promise.all([
    db.todo.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ completed: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    }),
    db.task.findMany({
      where: { userId, todoId: { not: null }, session: { phase: { not: 'ENDED' } } },
      select: { todoId: true, session: { select: { room: { select: { id: true } } } } },
    }),
  ]);
  const linked = new Map(active.map((task) => [task.todoId!, task.session.room?.id ?? null]));
  const byParent = new Map<string | null, typeof items>();
  for (const item of items) {
    const siblings = byParent.get(item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.parentId, siblings);
  }
  const build = (parentId: string | null, depth = 0): TodoView[] =>
    (byParent.get(parentId) ?? []).map((item) =>
      view(item, linked.get(item.id) ?? null, depth < 8 ? build(item.id, depth + 1) : []),
    );
  return build(null);
}

async function validateParent(
  tx: Tx,
  userId: string,
  parentId: string | null | undefined,
  id?: string,
) {
  if (!parentId) return;
  if (parentId === id) throw new AppError('VALIDATION_ERROR', '子任务不能以自己为上级', 400);
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 20; depth++) {
    const parent: { userId: string; parentId: string | null } | null = await tx.todo.findUnique({
      where: { id: cursor },
      select: { userId: true, parentId: true },
    });
    if (!parent || parent.userId !== userId) throw new AppError('NOT_FOUND', '上级待办不存在', 404);
    if (parent.parentId === id)
      throw new AppError('VALIDATION_ERROR', '子任务层级不能形成循环', 400);
    cursor = parent.parentId;
  }
}

export async function createTodo(userId: string, payload: unknown) {
  const input = todoCreateSchema.parse(payload);
  return db.$transaction(async (tx) => {
    await validateParent(tx, userId, input.parentId);
    if ((await tx.todo.count({ where: { userId, archivedAt: null } })) >= 10000)
      throw new AppError('VALIDATION_ERROR', '待办清单最多保留 10000 项', 400);
    const item = await tx.todo.create({
      data: {
        userId,
        title: input.title,
        parentId: input.parentId,
        priority: input.priority,
        dueAt: date(input.dueAt),
        scheduledStart: date(input.scheduledStart),
        scheduledEnd: date(input.scheduledEnd),
        labels: JSON.stringify(input.labels),
        recurrence: input.recurrence,
      },
    });
    return view(item, null);
  });
}

async function createNextOccurrence(tx: Tx, item: TodoRow) {
  if (!['DAILY', 'WEEKLY'].includes(item.recurrence)) return;
  const days = item.recurrence === 'DAILY' ? 1 : 7;
  const shift = (value: Date | null) =>
    value ? new Date(value.getTime() + days * 24 * 60 * 60 * 1000) : null;
  const dueAt = shift(item.dueAt);
  const scheduledStart = shift(item.scheduledStart);
  const scheduledEnd = shift(item.scheduledEnd);
  const seriesId = item.seriesId ?? item.id;
  const existing = await tx.todo.findFirst({
    where: {
      userId: item.userId,
      seriesId,
      archivedAt: null,
      ...(scheduledStart ? { scheduledStart } : { dueAt }),
    },
    select: { id: true },
  });
  if (existing) return;
  await tx.todo.create({
    data: {
      userId: item.userId,
      parentId: item.parentId,
      title: item.title,
      priority: item.priority,
      dueAt,
      scheduledStart,
      scheduledEnd,
      labels: item.labels,
      recurrence: item.recurrence,
      seriesId,
    },
  });
}

export async function syncTodoCompletion(
  tx: Tx,
  todoId: string,
  userId: string,
  completed: boolean,
) {
  const item = await tx.todo.findFirst({ where: { id: todoId, userId, archivedAt: null } });
  if (!item || item.completed === completed) return;
  await tx.todo.update({
    where: { id: item.id },
    data: {
      completed,
      completedAt: completed ? new Date() : null,
      version: { increment: 1 },
    },
  });
  if (completed) await createNextOccurrence(tx, item);
}

export async function updateTodo(userId: string, id: string, payload: unknown) {
  const input = todoUpdateSchema.parse(payload);
  return db.$transaction(async (tx) => {
    const item = await tx.todo.findFirst({ where: { id, userId, archivedAt: null } });
    if (!item) throw new AppError('NOT_FOUND', '待办不存在', 404);
    if (item.version !== input.version)
      throw new AppError('CONFLICT', '待办已在另一页面更新，请刷新后重试', 409);
    await validateParent(tx, userId, input.parentId, id);
    const nextRecurrence = input.recurrence ?? item.recurrence;
    const nextDueAt = input.dueAt === undefined ? item.dueAt : date(input.dueAt);
    const nextScheduledStart =
      input.scheduledStart === undefined ? item.scheduledStart : date(input.scheduledStart);
    if (nextRecurrence !== 'NONE' && !nextDueAt && !nextScheduledStart)
      throw new AppError('VALIDATION_ERROR', '重复任务需要设置截止日期或日程开始时间', 400);
    const changedToComplete = input.completed === true && !item.completed;
    const updated = await tx.todo.update({
      where: { id, version: input.version },
      data: {
        title: input.title,
        parentId: input.parentId,
        priority: input.priority,
        dueAt: date(input.dueAt),
        scheduledStart: date(input.scheduledStart),
        scheduledEnd: date(input.scheduledEnd),
        labels: input.labels === undefined ? undefined : JSON.stringify(input.labels),
        recurrence: input.recurrence,
        completed: input.completed,
        completedAt:
          input.completed === undefined
            ? undefined
            : input.completed
              ? (item.completedAt ?? new Date())
              : null,
        version: { increment: 1 },
      },
    });
    if (changedToComplete) await createNextOccurrence(tx, { ...item, ...updated });
    const linked = await tx.task.findMany({
      where: { todoId: id, userId, session: { phase: { not: 'ENDED' } } },
      select: {
        id: true,
        completed: true,
        firstCompletedRound: true,
        session: { select: { roundNo: true, room: { select: { id: true } } } },
      },
    });
    if (input.completed !== undefined) {
      for (const task of linked) {
        await tx.task.update({
          where: { id: task.id },
          data: {
            completed: input.completed,
            completedAt: input.completed ? new Date() : null,
            firstCompletedRound:
              input.completed && !task.completed && task.firstCompletedRound === null
                ? task.session.roundNo
                : undefined,
            version: { increment: 1 },
          },
        });
      }
    }
    const roomIds = [
      ...new Set(linked.flatMap((task) => (task.session.room?.id ? [task.session.room.id] : []))),
    ];
    for (const roomId of roomIds) await bump(tx, roomId);
    return { todo: view(updated, roomIds[0] ?? null), roomIds };
  });
}

export async function archiveTodo(userId: string, id: string, version: number) {
  return db.$transaction(async (tx) => {
    const item = await tx.todo.findFirst({ where: { id, userId, archivedAt: null } });
    if (!item) throw new AppError('NOT_FOUND', '待办不存在', 404);
    if (item.version !== version) throw new AppError('CONFLICT', '待办已更新，请刷新后重试', 409);
    const all = await tx.todo.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, parentId: true },
    });
    const ids = [id];
    for (let cursor = 0; cursor < ids.length; cursor++)
      for (const child of all)
        if (child.parentId === ids[cursor] && !ids.includes(child.id)) ids.push(child.id);
    await tx.todo.updateMany({ where: { id: { in: ids } }, data: { archivedAt: new Date() } });
    return { ok: true };
  });
}

export async function addTodoToRoom(userId: string, todoId: string, payload: unknown) {
  const input = todoRoomSchema.parse(payload);
  return db.$transaction((tx) =>
    receipt(tx, userId, input.requestId, 'todo:add-to-room', { todoId, ...input }, async () => {
      const { room, member } = await requireMember(input.roomId, userId, tx);
      if (room.session.phase === 'ENDED' || member.leftAt)
        throw new AppError('ROOM_ENDED', '共学已结束，不能再加入任务', 409);
      const todo = await tx.todo.findFirst({ where: { id: todoId, userId, archivedAt: null } });
      if (!todo) throw new AppError('NOT_FOUND', '待办不存在', 404);
      const existing = await tx.task.findFirst({
        where: { sessionId: room.sessionId, userId, todoId },
      });
      if (!existing) {
        const parentTask = todo.parentId
          ? await tx.task.findFirst({
              where: { sessionId: room.sessionId, userId, todoId: todo.parentId },
              select: { id: true },
            })
          : null;
        await tx.task.create({
          data: {
            sessionId: room.sessionId,
            userId,
            todoId,
            parentId: parentTask?.id,
            title: todo.title,
            completed: todo.completed,
            completedAt: todo.completedAt,
            priority: todo.priority,
            dueAt: todo.dueAt,
            labels: todo.labels,
          },
        });
        await bump(tx, input.roomId);
      }
      return { roomId: input.roomId };
    }),
  );
}
