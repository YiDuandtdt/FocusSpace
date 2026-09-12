import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(resolve('.tmp/planning-'));
const file = resolve(directory, 'test.db');
process.env.DATABASE_URL = `file:${file.replaceAll('\\', '/')}`;
const sqlite = new DatabaseSync(file);
for (const name of readdirSync('prisma/migrations')
  .filter((value) => value.startsWith('20'))
  .sort())
  sqlite.exec(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
sqlite.close();

const { db } = await import('../apps/server/src/db.js');
const { createTodo, updateTodo, addTodoToRoom, todos } = await import(
  '../apps/server/src/modules/todo.js'
);
const { taskCommand } = await import('../apps/server/src/modules/task.js');
const { advanceSession } = await import('../apps/server/src/modules/session.js');
const { analytics, leaderboards } = await import('../apps/server/src/modules/analytics.js');
const { summary } = await import('../apps/server/src/modules/record.js');

for (const id of ['planner', 'study_friend'])
  await db.user.create({
    data: {
      id,
      username: id,
      nickname: id === 'planner' ? '计划者' : '同学',
      passwordHash: 'test',
    },
  });

await db.studySession.create({
  data: {
    id: 'linked-session',
    phase: 'LOBBY',
    roundNo: 0,
    focusSeconds: 1500,
    breakSeconds: 300,
    targetRounds: null,
    room: {
      create: {
        id: 'linked-room',
        code: 'PLAN01',
        name: '任务联动验证',
        ownerId: 'planner',
        members: { create: { userId: 'planner', seatIndex: 0, connectionState: 'CONNECTED' } },
      },
    },
  },
});
const parent = await createTodo('planner', {
  title: '完成课程复习',
  priority: 'HIGH',
  labels: ['课程'],
  recurrence: 'NONE',
  dueAt: '2026-09-12T15:59:00.000Z',
  scheduledStart: null,
  scheduledEnd: null,
  parentId: null,
});
const child = await createTodo('planner', {
  title: '整理第一章笔记',
  parentId: parent.id,
  priority: 'MEDIUM',
  labels: ['课程', '笔记'],
  recurrence: 'DAILY',
  dueAt: '2026-09-12T15:59:00.000Z',
  scheduledStart: null,
  scheduledEnd: null,
});
const firstRequest = crypto.randomUUID();
await addTodoToRoom('planner', parent.id, { roomId: 'linked-room', requestId: firstRequest });
await addTodoToRoom('planner', parent.id, { roomId: 'linked-room', requestId: firstRequest });
await addTodoToRoom('planner', child.id, { roomId: 'linked-room', requestId: crypto.randomUUID() });
const roomTasks = await db.task.findMany({
  where: { sessionId: 'linked-session' },
  orderBy: { createdAt: 'asc' },
});
assert.equal(roomTasks.length, 2, 'idempotent room linking must not duplicate tasks');
assert.equal(
  roomTasks[1].parentId,
  roomTasks[0].id,
  'todo hierarchy must be copied into room tasks',
);
assert.equal(roomTasks[0].priority, 'HIGH');

await updateTodo('planner', child.id, { version: child.version, completed: true });
let linkedTask = await db.task.findFirstOrThrow({ where: { todoId: child.id } });
assert.equal(linkedTask.completed, true);
assert.equal(linkedTask.firstCompletedRound, 0);
assert.equal(
  (await todos('planner'))
    .flatMap((item) => item.children)
    .filter((item) => item.title === child.title).length,
  2,
  'daily completion creates exactly one next occurrence',
);
await taskCommand('planner', 'linked-room', crypto.randomUUID(), 'task:update', {
  taskId: linkedTask.id,
  version: linkedTask.version,
  completed: false,
});
assert.equal(
  (await db.todo.findUniqueOrThrow({ where: { id: child.id } })).completed,
  false,
  'room progress must sync back to todo',
);
linkedTask = await db.task.findUniqueOrThrow({ where: { id: linkedTask.id } });
await taskCommand('planner', 'linked-room', crypto.randomUUID(), 'task:update', {
  taskId: linkedTask.id,
  version: linkedTask.version,
  completed: true,
});
assert.equal((await db.todo.findUniqueOrThrow({ where: { id: child.id } })).completed, true);
assert.equal(
  await db.todo.count({ where: { seriesId: child.id } }),
  1,
  'rechecking one occurrence must not create duplicate future instances',
);
console.log('PASS todo hierarchy, idempotent room link, bidirectional progress and recurrence');

const start = new Date('2026-09-10T01:00:00.000Z');
const end = new Date(start.getTime() + 60_000);
await db.studySession.create({
  data: {
    id: 'round-session',
    phase: 'FOCUS',
    roundNo: 1,
    focusSeconds: 60,
    breakSeconds: 60,
    targetRounds: 1,
    startedAt: start,
    phaseStartAt: start,
    phaseEndAt: end,
    intervals: { create: { roundNo: 1, phase: 'FOCUS', startAt: start } },
    room: {
      create: {
        id: 'round-room',
        code: 'ROUND1',
        name: '一轮自动结束验证',
        ownerId: 'planner',
        members: {
          create: [
            { userId: 'planner', seatIndex: 0, connectionState: 'CONNECTED', lastSeenAt: start },
            {
              userId: 'study_friend',
              seatIndex: 1,
              connectionState: 'CONNECTED',
              lastSeenAt: start,
            },
          ],
        },
      },
    },
    presence: {
      create: [
        { userId: 'planner', startAt: start },
        { userId: 'study_friend', startAt: start },
      ],
    },
  },
});
await db.$transaction((tx) => advanceSession(tx, 'round-room', end));
const ended = await db.studySession.findUniqueOrThrow({ where: { id: 'round-session' } });
assert.equal(ended.phase, 'ENDED');
assert.equal(ended.endReason, 'ROUNDS_COMPLETED');
assert.equal(
  (
    await db.studyRecord.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: 'round-session', userId: 'planner' } },
    })
  ).focusSeconds,
  60,
);
const report = await analytics('planner', 'day', end.getTime());
assert.equal(report.totals.sessions, 1);
assert.equal(report.totals.focusSeconds, 60);
assert(
  (await leaderboards('planner')).focus.some(
    (entry) => entry.userId === 'planner' && entry.value === 60,
  ),
);
const result = await summary('round-session', 'planner');
assert.equal(result.endReason, 'ROUNDS_COMPLETED');
assert.deepEqual(result.analysis.tasks, []);
console.log('PASS controlled-clock target rounds, settlement, analytics and leaderboard');

await db.$disconnect();
