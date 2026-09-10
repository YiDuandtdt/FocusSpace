import type { Prisma } from '@prisma/client';
import type { SessionSummary, LearningFeedback, HistoryPage } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { awardRecord, rewardSummary, compensateRewards } from './growth.js';

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
export async function saveRecords(tx: Prisma.TransactionClient, roomId: string, at = new Date()) {
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
      select: { userId: true, completed: true, createdAt: true, completedAt: true },
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
    const saved = await tx.studyRecord.upsert({
      where: { sessionId_userId: { sessionId: room.sessionId, userId: member.userId } },
      create: {
        sessionId: room.sessionId,
        userId: member.userId,
        ...record,
        settledAt: at,
        rewardState:
          room.session.focusSeconds === 45 && room.session.breakSeconds === 15
            ? 'DEMO'
            : room.session.rewardRules
              ? 'PENDING'
              : 'LEGACY',
        rewardFacts: JSON.stringify({
          goal: own.some(
            (t) =>
              t.completed &&
              t.completedAt &&
              t.completedAt <= at &&
              room.session.startedAt &&
              t.createdAt <= room.session.startedAt,
          ),
          togetherSeconds: Math.floor(
            mergeSpans(
              [...studied]
                .filter(([id]) => id !== member.userId)
                .flatMap(([, other]) => intersect(spans, other)),
            ).reduce((sum, [a, b]) => sum + b - a, 0) / 1000,
          ),
        }),
      },
      update: {},
    });
    await awardRecord(tx, saved.id);
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
  try {
    await compensateRewards(userId);
  } catch {
    console.warn('Reward compensation deferred; pending records retained');
  }
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
    reward: record ? await rewardSummary(record.id) : undefined,
    sessionId,
    roomId: session.room.id,
    roomName: session.room.name,
    startedAt: session.startedAt?.getTime() ?? null,
    endedAt: session.endedAt!.getTime(),
    endReason: session.endReason,
    recordAvailable: !!record,
    demoMode: session.focusSeconds === 45 && session.breakSeconds === 15,
    roomFocusSeconds: record ? (await learningFeedback(sessionId, userId)).roomFocusSeconds : null,
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

// Sweep merged intervals per user: three people still contribute one wall-clock second.
export function commonSeconds(users: Span[][]): number {
  const events = new Map<number, number>();
  for (const spans of users)
    for (const [a, b] of mergeSpans(spans)) {
      events.set(a, (events.get(a) ?? 0) + 1);
      events.set(b, (events.get(b) ?? 0) - 1);
    }
  let active = 0,
    previous = 0,
    total = 0;
  for (const [at, delta] of [...events].sort((a, b) => a[0] - b[0])) {
    if (active >= 2) total += at - previous;
    active += delta;
    previous = at;
  }
  return Math.floor(total / 1000);
}
export async function learningFeedback(
  sessionId: string,
  userId: string,
): Promise<LearningFeedback> {
  const [session, phases, presence, tasks] = await Promise.all([
    db.studySession.findUniqueOrThrow({ where: { id: sessionId } }),
    db.phaseInterval.findMany({
      where: { sessionId, phase: 'FOCUS' },
      orderBy: { startAt: 'asc' },
    }),
    db.presenceInterval.findMany({ where: { sessionId } }),
    db.task.findMany({
      where: { sessionId },
      select: { userId: true, completed: true, firstCompletedRound: true },
    }),
  ]);
  const at = session.endedAt?.getTime() ?? Date.now();
  const focus: Span[] = phases.map((p) => [
    p.startAt.getTime(),
    Math.min(p.endAt?.getTime() ?? at, at),
  ]);
  const users = [...new Set(presence.map((p) => p.userId))];
  const spans = new Map(
    users.map((id) => [
      id,
      intersect(
        mergeSpans(
          presence
            .filter((p) => p.userId === id)
            .map((p) => [p.startAt.getTime(), Math.min(p.endAt?.getTime() ?? at, at)]),
        ),
        focus,
      ),
    ]),
  );
  const own = spans.get(userId) ?? [];
  const round: Span[] = phases
    .filter((p) => p.roundNo === session.roundNo)
    .map((p) => [p.startAt.getTime(), Math.min(p.endAt?.getTime() ?? at, at)]);
  const seconds = (v: Span[]) => Math.floor(v.reduce((n, [a, b]) => n + b - a, 0) / 1000);
  return {
    roundNo: session.roundNo,
    focusSeconds: seconds(own),
    roundFocusSeconds: seconds(intersect(own, round)),
    roundTasksDone: session.feedbackVersion
      ? tasks.filter(
          (t) => t.userId === userId && t.completed && t.firstCompletedRound === session.roundNo,
        ).length
      : null,
    roomFocusSeconds: commonSeconds([...spans.values()]),
    roomTasksDone: tasks.filter((t) => t.completed).length,
    roomTasksTotal: tasks.length,
  };
}
export async function history(userId: string, page: number): Promise<HistoryPage> {
  const where = { userId, session: { phase: 'ENDED' as const } };
  const formal = {
    ...where,
    session: { phase: 'ENDED' as const, NOT: { focusSeconds: 45, breakSeconds: 15 } },
  };
  const [records, total, aggregate, demoSessions] = await Promise.all([
    db.studyRecord.findMany({
      where,
      orderBy: [{ session: { endedAt: 'desc' } }, { id: 'desc' }],
      skip: (page - 1) * 10,
      take: 10,
      select: { sessionId: true },
    }),
    db.studyRecord.count({ where }),
    db.studyRecord.aggregate({
      where: formal,
      _count: true,
      _sum: { focusSeconds: true, roundsCompleted: true, tasksDone: true, tasksTotal: true },
    }),
    db.studyRecord.count({
      where: { userId, session: { phase: 'ENDED', focusSeconds: 45, breakSeconds: 15 } },
    }),
  ]);
  return {
    items: await Promise.all(records.map((r) => summary(r.sessionId, userId))),
    page,
    total,
    demoSessions,
    totals: {
      sessions: aggregate._count,
      focusSeconds: aggregate._sum.focusSeconds ?? 0,
      roundsCompleted: aggregate._sum.roundsCompleted ?? 0,
      tasksDone: aggregate._sum.tasksDone ?? 0,
      tasksTotal: aggregate._sum.tasksTotal ?? 0,
    },
  };
}
