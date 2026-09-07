import type { Prisma } from '@prisma/client';
import type { SessionSummary } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';

type Span = [number, number];
// Merge overlaps for time totals. Touching intervals remain separate for the
// complete-round rule: a disconnect/AFK still interrupts a round.
export function mergeSpans(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const [start, end] of spans.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}
export function intersect(a: Span[], b: Span[]): Span[] {
  const result: Span[] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]),
      end = Math.min(a[i][1], b[j][1]);
    if (end > start) result.push([start, end]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return result;
}
export async function saveRecords(tx: Prisma.TransactionClient, roomId: string) {
  const room = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { members: true, session: true },
  });
  const [phases, presence, tasks] = await Promise.all([
    tx.phaseInterval.findMany({
      where: { sessionId: room.sessionId, phase: 'FOCUS', endAt: { not: null } },
      orderBy: { startAt: 'asc' },
    }),
    tx.presenceInterval.findMany({ where: { sessionId: room.sessionId, endAt: { not: null } } }),
    tx.task.findMany({
      where: { sessionId: room.sessionId },
      select: { userId: true, completed: true },
    }),
  ]);
  const focus: Span[] = phases.map((p) => [p.startAt.getTime(), p.endAt!.getTime()]);
  const complete = focus.filter(([a, b]) => b - a === room.session.focusSeconds * 1000);
  const online = new Map(
    room.members.map((m) => [
      m.userId,
      mergeSpans(
        presence
          .filter((p) => p.userId === m.userId)
          .map((p) => [p.startAt.getTime(), p.endAt!.getTime()]),
      ),
    ]),
  );
  const studied = new Map([...online].map(([id, spans]) => [id, intersect(spans, focus)]));
  for (const member of room.members) {
    const spans = studied.get(member.userId)!;
    const own = tasks.filter((t) => t.userId === member.userId);
    const record = {
      focusSeconds: Math.floor(spans.reduce((sum, [a, b]) => sum + b - a, 0) / 1000),
      roundsCompleted: complete.filter(([a, b]) =>
        online.get(member.userId)!.some(([x, y]) => x <= a && y >= b),
      ).length,
      tasksDone: own.filter((t) => t.completed).length,
      tasksTotal: own.length,
      studiedWith: [...studied].filter(
        ([id, other]) => id !== member.userId && intersect(spans, other).length > 0,
      ).length,
    };
    await tx.studyRecord.upsert({
      where: { sessionId_userId: { sessionId: room.sessionId, userId: member.userId } },
      create: { sessionId: room.sessionId, userId: member.userId, ...record },
      update: {},
    });
  }
}
export async function summary(sessionId: string, userId: string): Promise<SessionSummary> {
  const session = await db.studySession.findUnique({
    where: { id: sessionId },
    include: { room: { include: { members: true } } },
  });
  if (!session?.room || !session.room.members.some((m) => m.userId === userId))
    throw new AppError('ROOM_NOT_FOUND', '学习记录不存在', 404);
  if (session.phase !== 'ENDED') throw new AppError('INVALID_PHASE', '本次共学还未结束', 409);
  const [record, phases] = await Promise.all([
    db.studyRecord.findUnique({ where: { sessionId_userId: { sessionId, userId } } }),
    db.phaseInterval.findMany({ where: { sessionId, phase: 'FOCUS', endAt: { not: null } } }),
  ]);
  // Phase-one rooms that ended before this migration have no time or tasks.
  const values = record ?? {
    focusSeconds: 0,
    roundsCompleted: 0,
    tasksDone: 0,
    tasksTotal: 0,
    studiedWith: 0,
  };
  return {
    sessionId,
    roomId: session.room.id,
    roomName: session.room.name,
    startedAt: session.startedAt?.getTime() ?? null,
    endedAt: session.endedAt!.getTime(),
    endReason: session.endReason,
    roomRoundsCompleted: phases.filter(
      (p) => p.endAt!.getTime() - p.startAt.getTime() === session.focusSeconds * 1000,
    ).length,
    record: {
      focusSeconds: values.focusSeconds,
      roundsCompleted: values.roundsCompleted,
      tasksDone: values.tasksDone,
      tasksTotal: values.tasksTotal,
      studiedWith: values.studiedWith,
      progressPercent: values.tasksTotal
        ? Math.round((values.tasksDone / values.tasksTotal) * 100)
        : null,
    },
  };
}
