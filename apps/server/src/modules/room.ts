import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ROOM_CAPACITY, type RoomSnapshot, type Member } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { digest } from './auth.js';
import { config } from '../config.js';
import { openPresence, closePresence } from './presence.js';
import { finishSession, reconnectDeadline } from './session.js';
import { recentMessages } from './chat.js';
import { summary, learningFeedback } from './record.js';

type Tx = Prisma.TransactionClient;
const include = {
  session: true,
  members: { include: { user: true }, orderBy: { seatIndex: 'asc' as const } },
};
export async function currentRoom(userId: string, tx: Tx = db) {
  const member = await tx.roomMember.findFirst({
    where: { userId, leftAt: null, room: { session: { phase: { not: 'ENDED' } } } },
    select: { roomId: true },
  });
  return member?.roomId ?? null;
}
export async function receipt<T>(
  tx: Tx,
  userId: string,
  requestId: string,
  commandType: string,
  payload: unknown,
  work: () => Promise<T>,
): Promise<T> {
  const payloadHash = digest(JSON.stringify(payload));
  const old = await tx.commandReceipt.findUnique({
    where: { userId_requestId: { userId, requestId } },
  });
  if (old) {
    if (old.commandType !== commandType || old.payloadHash !== payloadHash)
      throw new AppError('CONFLICT', '此请求标识已用于不同操作，请重新操作', 409);
    const result = JSON.parse(old.result);
    if (result.removed) throw new AppError('MESSAGE_REMOVED', '消息已由管理员移除', 409);
    if (result.expired) throw new AppError('REQUEST_EXPIRED', '该消息已超过保留期限', 409);
    return result as T;
  }
  const result = await work();
  await tx.commandReceipt.create({
    data: {
      userId,
      requestId,
      commandType,
      payloadHash,
      result: JSON.stringify(result),
      roomId: (result as { roomId?: string })?.roomId ?? (payload as { roomId?: string })?.roomId,
    },
  });
  return result;
}
export async function createRoom(
  userId: string,
  input: {
    requestId: string;
    name: string;
    focusSeconds: number;
    breakSeconds: number;
    visibility?: string;
  },
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, input.requestId, 'room:create', input, async () => {
      if (await currentRoom(userId, tx))
        throw new AppError('ALREADY_IN_ROOM', '请先返回当前房间并离开，再创建新房间', 409);
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code: string;
      do {
        code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
      } while (await tx.room.findUnique({ where: { code } }));
      const room = await tx.room.create({
        data: {
          name: input.name,
          visibility: input.visibility ?? 'PRIVATE',
          code,
          owner: { connect: { id: userId } },
          capacity: ROOM_CAPACITY,
          session: {
            create: { focusSeconds: input.focusSeconds, breakSeconds: input.breakSeconds },
          },
          members: { create: { userId, seatIndex: 0 } },
        },
      });
      return { roomId: room.id, code: room.code, sessionId: room.sessionId };
    }),
  );
}
export async function joinRoom(
  userId: string,
  input: { requestId: string; code?: string; publicRoomId?: string },
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, input.requestId, 'room:membership', input, async () => {
      const room = await tx.room.findUnique({
        where: input.publicRoomId ? { id: input.publicRoomId } : { code: input.code },
        include,
      });
      if (input.publicRoomId && room?.visibility !== 'PUBLIC')
        throw new AppError('ROOM_NOT_PUBLIC', '房间已转为私有或下架，请刷新公开列表', 409);
      if (!room) throw new AppError('ROOM_NOT_FOUND', '没有找到这个房间，请检查房间码', 404);
      if (room.session.phase === 'ENDED')
        throw new AppError('ROOM_ENDED', '这个房间已结束，请向朋友获取新的房间码', 409);
      const active = await currentRoom(userId, tx);
      if (active && active !== room.id)
        throw new AppError('ALREADY_IN_ROOM', '你已在另一个房间，请先返回并离开', 409);
      const existing = room.members.find((m) => m.userId === userId && !m.leftAt);
      if (!existing) {
        const occupied = new Set(room.members.filter((m) => !m.leftAt).map((m) => m.seatIndex));
        if (occupied.size >= room.capacity)
          throw new AppError('ROOM_FULL', '房间已满，最多容纳 8 人', 409);
        const seatIndex = Array.from({ length: room.capacity }, (_, i) => i).find(
          (i) => !occupied.has(i),
        )!;
        await tx.roomMember.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          create: { roomId: room.id, userId, seatIndex },
          update: {
            seatIndex,
            ready: false,
            afk: false,
            leftAt: null,
            joinedAt: new Date(),
            lastSeenAt: new Date(),
            reconnectDeadlineAt: null,
            connectionState: 'DISCONNECTED',
          },
        });
        await bump(tx, room.id);
      }
      return { roomId: room.id, code: room.code, sessionId: room.sessionId };
    }),
  );
}
export async function requireMember(
  roomId: string,
  userId: string,
  tx: Tx = db,
  allowHistory = false,
) {
  const room = await tx.room.findUnique({ where: { id: roomId }, include });
  const member = room?.members.find((m) => m.userId === userId);
  if (!room || !member || (member.leftAt && !(allowHistory && room.session.phase === 'ENDED')))
    throw new AppError('ROOM_NOT_FOUND', '房间不存在，或你已离开该房间', 404);
  return { room, member };
}
export const bump = (tx: Tx, roomId: string) =>
  tx.room.update({ where: { id: roomId }, data: { revision: { increment: 1 } } });
export async function snapshot(roomId: string, userId: string): Promise<RoomSnapshot> {
  const { room, member } = await requireMember(roomId, userId, db, true);
  const ended = room.session.phase === 'ENDED';
  const [tasks, myTasks, result, messages, feedback, publicTasks] = await Promise.all([
    db.task.findMany({
      where: { sessionId: room.sessionId },
      select: { userId: true, completed: true },
    }),
    db.task.findMany({
      where: { sessionId: room.sessionId, userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        completed: true,
        completedAt: true,
        version: true,
        visibility: true,
      },
    }),
    ended ? summary(room.sessionId, userId) : Promise.resolve(null),
    recentMessages(room.sessionId),
    learningFeedback(room.sessionId, userId),
    db.task.findMany({
      where: { sessionId: room.sessionId, visibility: 'PUBLIC' },
      select: { id: true, userId: true, title: true, completed: true },
    }),
  ]);
  const retained = room.members.filter((m) => !m.leftAt);
  return {
    room: {
      id: room.id,
      name: room.name,
      code: room.code,
      ownerId: room.ownerId,
      capacity: room.capacity,
      visibility: room.visibility as 'PRIVATE' | 'PUBLIC',
      delisted: !!room.delistedAt,
    },
    session: {
      id: room.sessionId,
      phase: room.session.phase,
      roundNo: room.session.roundNo,
      focusSeconds: room.session.focusSeconds,
      breakSeconds: room.session.breakSeconds,
      phaseStartAt: room.session.phaseStartAt?.getTime() ?? null,
      phaseEndAt: room.session.phaseEndAt?.getTime() ?? null,
      endedAt: room.session.endedAt?.getTime() ?? null,
      endReason: room.session.endReason,
      demoMode: room.session.focusSeconds === 45 && room.session.breakSeconds === 15,
    },
    members: room.members
      .filter((m) => !m.leftAt)
      .map(
        (m): Member => ({
          userId: m.userId,
          nickname: m.user.nickname,
          avatarId: m.user.avatarId as Member['avatarId'],
          seatIndex: m.seatIndex,
          ready: m.ready,
          afk: m.afk,
          connectionState: m.connectionState,
          status: ended
            ? 'ENDED'
            : m.connectionState === 'DISCONNECTED'
              ? 'DISCONNECTED'
              : m.afk
                ? 'AFK'
                : room.session.phase === 'FOCUS'
                  ? 'FOCUSING'
                  : room.session.phase === 'BREAK'
                    ? 'BREAKING'
                    : m.ready
                      ? 'READY'
                      : 'JOINED',
          isOwner: m.userId === room.ownerId,
          joinedAt: m.joinedAt.getTime(),
          lateJoin: !!room.session.startedAt && m.joinedAt > room.session.startedAt,
          publicTasks: publicTasks
            .filter((t) => t.userId === m.userId)
            .map(({ id, title, completed }) => ({ id, title, completed })),
          tasksDone: tasks.filter((t) => t.userId === m.userId && t.completed).length,
          tasksTotal: tasks.filter((t) => t.userId === m.userId).length,
          progressPercent: tasks.some((t) => t.userId === m.userId)
            ? Math.round(
                (tasks.filter((t) => t.userId === m.userId && t.completed).length /
                  tasks.filter((t) => t.userId === m.userId).length) *
                  100,
              )
            : null,
        }),
      ),
    recentMessages: messages,
    feedback,
    myTasks: myTasks.map((t) => ({
      ...t,
      visibility: t.visibility as 'PRIVATE' | 'PUBLIC',
      completedAt: t.completedAt?.getTime() ?? null,
    })),
    demoAvailable: config.DEMO_MODE === 'true',
    summary: result,
    myPermissions: {
      isOwner: room.ownerId === userId,
      canParticipate: !ended && !member.leftAt,
      canConfigure: room.ownerId === userId && room.session.phase === 'LOBBY' && !member.leftAt,
      startDisabledReason:
        room.ownerId !== userId
          ? '由房主开始共学'
          : room.session.phase !== 'LOBBY'
            ? '共学已开始或结束'
            : retained.some((m) => m.connectionState !== 'CONNECTED')
              ? '等待所有成员恢复连接'
              : retained.some((m) => m.afk)
                ? '等待暂离成员回来'
                : retained.some((m) => !m.ready)
                  ? '请所有成员（含房主）先准备'
                  : null,
      canStart:
        room.ownerId === userId &&
        room.session.phase === 'LOBBY' &&
        retained.length > 0 &&
        retained.every((m) => m.ready && !m.afk && m.connectionState === 'CONNECTED'),
      canChat:
        !member.leftAt && member.connectionState === 'CONNECTED' && room.session.phase === 'BREAK',
    },
    revision: room.revision,
    serverTime: Date.now(),
  };
}
export async function setConnected(
  roomId: string,
  userId: string,
  connected: boolean,
  at = new Date(),
) {
  await db.$transaction(async (tx) => {
    const { room, member } = await requireMember(roomId, userId, tx, true);
    if (room.session.phase === 'ENDED' || member.leftAt) return;
    const state = connected ? 'CONNECTED' : 'DISCONNECTED';
    if (member.connectionState === state) return;
    if (connected && reconnectDeadline(member) <= at) {
      await leaveMember(tx, roomId, userId, 'OWNER_DISCONNECTED', reconnectDeadline(member));
      return;
    }
    await tx.roomMember.update({
      where: { id: member.id },
      data: {
        connectionState: state,
        lastSeenAt: at,
        reconnectDeadlineAt: connected ? null : new Date(at.getTime() + config.DISCONNECT_GRACE_MS),
      },
    });
    if (!connected) await closePresence(tx, room.sessionId, userId, at, 'DISCONNECTED');
    else if (!member.afk && room.session.phase !== 'LOBBY')
      await openPresence(tx, room.sessionId, userId, at);
    await bump(tx, roomId);
  });
}
// All callers run inside the single writer queue and one database transaction.
export async function transferOwner(tx: Tx, roomId: string, ownerId: string, targetId?: string) {
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId }, include });
  if (room.ownerId !== ownerId || room.session.phase === 'ENDED')
    throw new AppError('CONFLICT', '房主或房间状态已变化，请刷新后重试', 409);
  const eligible = room.members
    .filter(
      (m) =>
        !m.leftAt &&
        m.userId !== ownerId &&
        m.connectionState === 'CONNECTED' &&
        !m.afk &&
        !m.user.bannedAt,
    )
    .sort(
      (a, b) =>
        a.joinedAt.getTime() - b.joinedAt.getTime() ||
        a.seatIndex - b.seatIndex ||
        a.userId.localeCompare(b.userId),
    );
  const target = targetId ? eligible.find((m) => m.userId === targetId) : eligible[0];
  if (!target) {
    if (targetId) throw new AppError('CONFLICT', '接任成员已离线、暂离或失去成员资格', 409);
    return false;
  }
  await tx.room.update({
    where: { id: roomId },
    data: { ownerId: target.userId, revision: { increment: 1 } },
  });
  return true;
}
export async function leaveMember(
  tx: Tx,
  roomId: string,
  userId: string,
  reason: string,
  at = new Date(),
) {
  const room = await tx.room.findUnique({ where: { id: roomId }, include });
  const member = room?.members.find((m) => m.userId === userId);
  if (!room || !member || member.leftAt || room.session.phase === 'ENDED') return;
  if (room.ownerId === userId && !(await transferOwner(tx, roomId, userId))) {
    await finishSession(tx, roomId, reason, at);
    return;
  }
  await closePresence(tx, room.sessionId, userId, at, reason);
  await tx.roomMember.update({
    where: { id: member.id },
    data: {
      leftAt: at,
      ready: false,
      connectionState: 'DISCONNECTED',
      reconnectDeadlineAt: null,
    },
  });
  await bump(tx, roomId);
}
export async function ownerCommand(
  userId: string,
  roomId: string,
  requestId: string,
  type: string,
  payload: { targetId?: string; leave?: boolean; visibility?: 'PRIVATE' | 'PUBLIC' },
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, type, { roomId, payload }, async () => {
      const { room, member } = await requireMember(roomId, userId, tx);
      if (room.ownerId !== userId) throw new AppError('FORBIDDEN', '只有当前房主可以操作', 403);
      if (room.session.phase === 'ENDED' || member.connectionState !== 'CONNECTED')
        throw new AppError('CONFLICT', '请等待连接恢复，且房间必须仍在进行', 409);
      if (type === 'room:transfer') {
        await transferOwner(tx, roomId, userId, payload.targetId);
        if (payload.leave) await leaveMember(tx, roomId, userId, 'TRANSFER_LEFT');
      } else {
        if (payload.visibility === 'PUBLIC' && room.delistedAt)
          throw new AppError('FORBIDDEN', '该房间已被管理员下架，本场共学不能重新公开', 403);
        await tx.room.update({ where: { id: roomId }, data: { visibility: payload.visibility } });
        await bump(tx, roomId);
      }
      return { roomId };
    }),
  );
}
export async function mutateMember(
  userId: string,
  roomId: string,
  requestId: string,
  type: string,
  payload: { ready?: boolean; afk?: boolean; focusSeconds?: number; breakSeconds?: number },
) {
  return db.$transaction((tx) =>
    receipt(tx, userId, requestId, type, { roomId, payload }, async () => {
      const { room, member } = await requireMember(roomId, userId, tx);
      if (room.session.phase === 'ENDED') throw new AppError('ROOM_ENDED', '房间已经结束', 409);
      if (type === 'member:leave') {
        await leaveMember(tx, roomId, userId, 'OWNER_LEFT');
        return { roomId };
      }
      if (member.connectionState !== 'CONNECTED')
        throw new AppError('CONFLICT', '请等待实时连接恢复', 409);
      if (type === 'room:configure') {
        if (room.ownerId !== userId)
          throw new AppError('FORBIDDEN', '只有房主可以修改学习节奏', 403);
        if (room.session.phase !== 'LOBBY')
          throw new AppError('INVALID_PHASE', '只能在大厅修改节奏', 409);
        await tx.studySession.update({
          where: { id: room.sessionId },
          data: { focusSeconds: payload.focusSeconds, breakSeconds: payload.breakSeconds },
        });
        await tx.roomMember.updateMany({ where: { roomId, leftAt: null }, data: { ready: false } });
      } else {
        if (type === 'member:ready' && room.session.phase !== 'LOBBY')
          throw new AppError('INVALID_PHASE', '只能在大厅设置准备状态', 409);
        await tx.roomMember.update({
          where: { id: member.id },
          data: type === 'member:ready' ? { ready: payload.ready } : { afk: payload.afk },
        });
        if (type === 'member:afk' && member.afk !== payload.afk) {
          if (payload.afk) await closePresence(tx, room.sessionId, userId, new Date(), 'AFK');
          else if (room.session.phase !== 'LOBBY')
            await openPresence(tx, room.sessionId, userId, new Date());
        }
      }
      await bump(tx, roomId);
      return { roomId };
    }),
  );
}
