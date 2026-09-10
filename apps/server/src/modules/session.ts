import type { Prisma } from '@prisma/client';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { bump, receipt, requireMember, leaveMember } from './room.js';
import { openPresence, closePresence } from './presence.js';
import { saveRecords } from './record.js';
import { config } from '../config.js';

type Tx = Prisma.TransactionClient;
export async function advanceSession(tx: Tx, roomId: string, at = new Date()) {
  const room = await tx.room.findUnique({ where: { id: roomId }, include: { session: true } });
  if (!room) return false;
  const session = room.session;
  if (!['FOCUS', 'BREAK'].includes(session.phase) || !session.phaseEndAt || session.phaseEndAt > at)
    return false;
  await tx.phaseInterval.updateMany({
    where: { sessionId: session.id, endAt: null },
    data: { endAt: session.phaseEndAt },
  });
  let phase = session.phase;
  let roundNo = session.roundNo;
  let boundary = session.phaseEndAt;
  let startAt = boundary;
  let intervals: Prisma.PhaseIntervalCreateManyInput[] = [];
  // Compute boundaries in memory and insert in bounded batches. A long outage
  // must not require four database round trips for every missed phase.
  do {
    phase = phase === 'FOCUS' ? 'BREAK' : 'FOCUS';
    roundNo += phase === 'FOCUS' ? 1 : 0;
    startAt = boundary;
    boundary = new Date(
      startAt.getTime() + (phase === 'FOCUS' ? session.focusSeconds : session.breakSeconds) * 1000,
    );
    intervals.push({
      sessionId: session.id,
      roundNo,
      phase,
      startAt,
      endAt: boundary <= at ? boundary : null,
    });
    if (intervals.length === 100) {
      await tx.phaseInterval.createMany({ data: intervals });
      intervals = [];
    }
  } while (boundary <= at);
  if (intervals.length) await tx.phaseInterval.createMany({ data: intervals });
  await tx.studySession.update({
    where: { id: session.id },
    data: {
      phase,
      roundNo,
      phaseStartAt: startAt,
      phaseEndAt: boundary,
    },
  });
  await bump(tx, roomId);
  return true;
}

export function reconnectDeadline(member: { reconnectDeadlineAt: Date | null; lastSeenAt: Date }) {
  return (
    member.reconnectDeadlineAt ?? new Date(member.lastSeenAt.getTime() + config.DISCONNECT_GRACE_MS)
  );
}

async function reconcileRoom(tx: Tx, roomId: string, at: Date) {
  const room = await tx.room.findUnique({
    where: { id: roomId },
    include: { session: true, members: true },
  });
  if (!room || room.session.phase === 'ENDED') return false;
  const owner = room.members.find((member) => member.userId === room.ownerId);
  if (owner?.connectionState === 'DISCONNECTED' && reconnectDeadline(owner) <= at) {
    await leaveMember(tx, roomId, owner.userId, 'OWNER_DISCONNECTED', reconnectDeadline(owner));
    await advanceSession(tx, roomId, at);
    return true;
  }
  return advanceSession(tx, roomId, at);
}

export const advanceRoom = (roomId: string, at = new Date()) =>
  db.$transaction((tx) => reconcileRoom(tx, roomId, at), { timeout: 60000 });

export async function finishSession(tx: Tx, roomId: string, reason: string, at = new Date()) {
  await advanceSession(tx, roomId, at);
  const room = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { session: true, members: true },
  });
  if (room.session.phase === 'ENDED') return;
  await tx.phaseInterval.updateMany({
    where: { sessionId: room.sessionId, endAt: null },
    data: { endAt: at },
  });
  for (const member of room.members)
    await closePresence(tx, room.sessionId, member.userId, at, reason);
  await saveRecords(tx, roomId, at);
  await tx.studySession.update({
    where: { id: room.sessionId },
    data: { phase: 'ENDED', phaseEndAt: null, endedAt: at, endReason: reason },
  });
  await tx.roomMember.updateMany({
    where: { roomId, leftAt: null },
    data: { ready: false, connectionState: 'DISCONNECTED' },
  });
  await bump(tx, roomId);
}
export async function sessionCommand(
  userId: string,
  roomId: string,
  requestId: string,
  type: string,
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, type, { roomId, payload: {} }, async () => {
      const { room, member } = await requireMember(roomId, userId, tx, true);
      if (room.ownerId !== userId)
        throw new AppError('FORBIDDEN', '只有房主可以开始或结束共学', 403);
      if (type === 'session:end') {
        await finishSession(tx, roomId, 'OWNER_ENDED');
        return { roomId };
      }
      if (room.session.phase !== 'LOBBY')
        throw new AppError('INVALID_PHASE', '本次共学已经开始或结束', 409);
      const members = room.members.filter((m) => !m.leftAt);
      if (
        member.leftAt ||
        !members.length ||
        members.some((m) => !m.ready || m.afk || m.connectionState !== 'CONNECTED')
      )
        throw new AppError('NOT_READY', '请等待所有成员在线、取消暂离并准备好（包括房主）', 409);
      const now = new Date();
      await tx.studySession.update({
        where: { id: room.sessionId },
        data: {
          phase: 'FOCUS',
          roundNo: 1,
          startedAt: now,
          phaseStartAt: now,
          phaseEndAt: new Date(now.getTime() + room.session.focusSeconds * 1000),
        },
      });
      await tx.phaseInterval.create({
        data: { sessionId: room.sessionId, roundNo: 1, phase: 'FOCUS', startAt: now },
      });
      for (const m of members) await openPresence(tx, room.sessionId, m.userId, now);
      await bump(tx, roomId);
      return { roomId };
    }),
  );
}

export async function recoverSessions(at = new Date()) {
  const rooms = await db.room.findMany({
    where: { session: { phase: { not: 'ENDED' } } },
    include: { members: true },
  });
  for (const room of rooms)
    await db.$transaction(
      async (tx) => {
        // Close using the persisted last valid heartbeat BEFORE granting reconnect grace.
        for (const member of room.members)
          await closePresence(
            tx,
            room.sessionId,
            member.userId,
            member.lastSeenAt,
            'SERVER_RESTART',
          );
        for (const member of room.members.filter((member) => !member.leftAt))
          await tx.roomMember.update({
            where: { id: member.id },
            data: {
              connectionState: 'DISCONNECTED',
              reconnectDeadlineAt:
                member.connectionState === 'CONNECTED'
                  ? new Date(at.getTime() + config.DISCONNECT_GRACE_MS)
                  : reconnectDeadline(member),
            },
          });
        await reconcileRoom(tx, room.id, at);
        await bump(tx, room.id);
      },
      { timeout: 60000 },
    );
}
