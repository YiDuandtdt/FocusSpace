import type { AnalyticsReport, Leaderboards, LeaderboardEntry } from '@focusspace/shared';
import { db } from '../db.js';

const SHANGHAI = 8 * 60 * 60 * 1000;
const safeLabels = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((label): label is string => typeof label === 'string')
      : [];
  } catch {
    return [];
  }
};
const localParts = (at: number) => {
  const date = new Date(at + SHANGHAI);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
};
const localMidnight = (at: number) => {
  const p = localParts(at);
  return Date.UTC(p.year, p.month, p.day) - SHANGHAI;
};
const dayKey = (at: number) => new Date(at + SHANGHAI).toISOString().slice(0, 10);

function bounds(period: AnalyticsReport['period'], anchor: number) {
  const startOfDay = localMidnight(anchor);
  if (period === 'day') return [startOfDay, startOfDay + 86400000] as const;
  if (period === 'week') {
    const weekday = (new Date(startOfDay + SHANGHAI).getUTCDay() + 6) % 7;
    const start = startOfDay - weekday * 86400000;
    return [start, start + 7 * 86400000] as const;
  }
  const p = localParts(anchor);
  return [
    Date.UTC(p.year, p.month, 1) - SHANGHAI,
    Date.UTC(p.year, p.month + 1, 1) - SHANGHAI,
  ] as const;
}

export async function analytics(userId: string, period: AnalyticsReport['period'], anchor: number) {
  const [start, end] = bounds(period, anchor);
  const duration = end - start;
  const heatStart = localMidnight(end) - 83 * 86400000;
  const records = await db.studyRecord.findMany({
    where: {
      userId,
      session: {
        phase: 'ENDED',
        endedAt: { gte: new Date(Math.min(start - duration, heatStart)), lt: new Date(end) },
        NOT: { focusSeconds: 45, breakSeconds: 15 },
      },
    },
    include: { session: { select: { endedAt: true } } },
  });
  const current = records.filter((record) => {
    const at = record.session.endedAt?.getTime() ?? 0;
    return at >= start && at < end;
  });
  const previousRecords = records.filter((record) => {
    const at = record.session.endedAt?.getTime() ?? 0;
    return at >= start - duration && at < start;
  });
  const sessionIds = current.map((record) => record.sessionId);
  const tasks = sessionIds.length
    ? await db.task.findMany({ where: { userId, sessionId: { in: sessionIds } } })
    : [];
  const total = (items: typeof current) => ({
    focusSeconds: items.reduce((sum, item) => sum + item.focusSeconds, 0),
    sessions: items.length,
    tasksDone: items.reduce((sum, item) => sum + item.tasksDone, 0),
    tasksTotal: items.reduce((sum, item) => sum + item.tasksTotal, 0),
  });
  const bucketCount = period === 'day' ? 24 : Math.round(duration / 86400000);
  const trend: AnalyticsReport['trend'] = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = period === 'day' ? start + index * 3600000 : start + index * 86400000;
    const bucketEnd = bucketStart + (period === 'day' ? 3600000 : 86400000);
    const inBucket = current.filter((record) => {
      const at = record.session.endedAt?.getTime() ?? 0;
      return at >= bucketStart && at < bucketEnd;
    });
    const totals = total(inBucket);
    return {
      key: String(bucketStart),
      label:
        period === 'day'
          ? `${String(index).padStart(2, '0')}:00`
          : new Date(bucketStart + SHANGHAI).toLocaleDateString('zh-CN', {
              timeZone: 'UTC',
              month: 'numeric',
              day: 'numeric',
            }),
      focusSeconds: totals.focusSeconds,
      tasksDone: totals.tasksDone,
      tasksTotal: totals.tasksTotal,
    };
  });
  const heat = new Map<string, number>();
  for (const record of records) {
    const at = record.session.endedAt?.getTime() ?? 0;
    if (at >= heatStart) heat.set(dayKey(at), (heat.get(dayKey(at)) ?? 0) + record.focusSeconds);
  }
  const recordBySession = new Map(current.map((record) => [record.sessionId, record]));
  const labelMap = new Map<
    string,
    { tasksDone: number; tasksTotal: number; focusSeconds: number }
  >();
  const taskRows = tasks.map((task) => {
    const siblings = tasks.filter((candidate) => candidate.sessionId === task.sessionId);
    const focusSeconds = Math.round(
      (recordBySession.get(task.sessionId)?.focusSeconds ?? 0) / Math.max(1, siblings.length),
    );
    const labels = safeLabels(task.labels);
    for (const label of labels.length ? labels : ['未分类']) {
      const value = labelMap.get(label) ?? { tasksDone: 0, tasksTotal: 0, focusSeconds: 0 };
      value.tasksTotal++;
      value.tasksDone += Number(task.completed);
      value.focusSeconds += Math.round(focusSeconds / Math.max(1, labels.length));
      labelMap.set(label, value);
    }
    return { title: task.title, completed: task.completed, focusSeconds, labels };
  });
  return {
    period,
    startAt: start,
    endAt: end,
    totals: total(current),
    previous: total(previousRecords),
    trend,
    heatmap: Array.from({ length: 84 }, (_, index) => {
      const at = heatStart + index * 86400000;
      return { date: dayKey(at), focusSeconds: heat.get(dayKey(at)) ?? 0 };
    }),
    labels: [...labelMap]
      .map(([label, value]) => ({ label, ...value }))
      .sort((a, b) => b.focusSeconds - a.focusSeconds),
    tasks: taskRows.sort((a, b) => b.focusSeconds - a.focusSeconds).slice(0, 20),
  } satisfies AnalyticsReport;
}

export async function leaderboards(userId: string): Promise<Leaderboards> {
  const [weekStart, weekEnd] = bounds('week', Date.now());
  const [users, records, accounts] = await Promise.all([
    db.user.findMany({
      where: { bannedAt: null },
      select: { id: true, nickname: true, avatarId: true, avatarImage: true, avatarVersion: true },
    }),
    db.studyRecord.findMany({
      where: {
        session: {
          endedAt: { gte: new Date(weekStart), lt: new Date(weekEnd) },
          NOT: { focusSeconds: 45, breakSeconds: 15 },
        },
      },
      select: { userId: true, focusSeconds: true },
    }),
    db.growthAccount.findMany(),
  ]);
  const focus = new Map<string, number>();
  for (const record of records)
    focus.set(record.userId, (focus.get(record.userId) ?? 0) + record.focusSeconds);
  const level = new Map(accounts.map((account) => [account.userId, account.level]));
  const mapEntry = (
    user: (typeof users)[number],
    value: number,
    rank: number,
  ): LeaderboardEntry => ({
    rank,
    userId: user.id,
    nickname: user.nickname,
    avatarId: user.avatarId as LeaderboardEntry['avatarId'],
    avatarUrl: user.avatarImage ? `/api/avatars/${user.id}?v=${user.avatarVersion}` : null,
    value,
    level: level.get(user.id) ?? 1,
    isMe: user.id === userId,
  });
  const focusUsers = users
    .filter((user) => (focus.get(user.id) ?? 0) > 0 || user.id === userId)
    .sort((a, b) => (focus.get(b.id) ?? 0) - (focus.get(a.id) ?? 0));
  const levelUsers = users.sort(
    (a, b) =>
      (level.get(b.id) ?? 1) - (level.get(a.id) ?? 1) ||
      (focus.get(b.id) ?? 0) - (focus.get(a.id) ?? 0),
  );
  return {
    weekStart,
    focus: focusUsers
      .slice(0, 50)
      .map((user, index) => mapEntry(user, focus.get(user.id) ?? 0, index + 1)),
    level: levelUsers
      .slice(0, 50)
      .map((user, index) => mapEntry(user, level.get(user.id) ?? 1, index + 1)),
  };
}
