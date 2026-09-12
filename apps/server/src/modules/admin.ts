import type { Prisma } from '@prisma/client';
import { adminActionSchema, type AdminAction, type AdminImpact } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
import { authenticate, digest } from './auth.js';
import { bump, leaveMember, receipt } from './room.js';
import { finishSession } from './session.js';
import { pagination } from './public.js';
type Tx = Prisma.TransactionClient;
export async function requireAdmin(header?: string) {
  const auth = await authenticate(header);
  if (auth.user.role !== 'ADMIN') throw new AppError('FORBIDDEN', '仅管理员可访问', 403);
  return auth;
}
const userSelect = {
  id: true,
  username: true,
  nickname: true,
  role: true,
  bannedAt: true,
  banReason: true,
  createdAt: true,
} as const;
export async function adminList(kind: string, query: Record<string, unknown>) {
  const { page, pageSize, skip, q } = pagination(query, 20);
  const paging = { skip, take: pageSize };
  if (kind === 'users') {
    const where = { OR: [{ username: { contains: q } }, { nickname: { contains: q } }] };
    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging,
      }),
      db.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  if (kind === 'rooms') {
    const where: Prisma.RoomWhereInput = { name: { contains: q } };
    if (query.phase && !['LOBBY', 'FOCUS', 'BREAK', 'ENDED'].includes(String(query.phase)))
      throw new AppError('VALIDATION_ERROR', '阶段筛选无效');
    if (query.phase)
      where.session = { phase: query.phase as 'LOBBY' | 'FOCUS' | 'BREAK' | 'ENDED' };
    const [rooms, total] = await Promise.all([
      db.room.findMany({
        where,
        ...paging,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          delistedAt: true,
          capacity: true,
          session: {
            select: {
              id: true,
              phase: true,
              roundNo: true,
              focusSeconds: true,
              breakSeconds: true,
              endedAt: true,
              endReason: true,
            },
          },
          members: {
            where: { leftAt: null },
            orderBy: { seatIndex: 'asc' },
            select: {
              userId: true,
              seatIndex: true,
              connectionState: true,
              afk: true,
              user: { select: { nickname: true } },
            },
          },
        },
      }),
      db.room.count({ where }),
    ]);
    return {
      items: rooms.map((r) => ({
        ...r,
        members: r.members.map(({ user, ...m }) => ({ ...m, nickname: user.nickname })),
      })),
      total,
      page,
      pageSize,
    };
  }
  if (kind === 'messages') {
    const where: Prisma.ChatMessageWhereInput = {
      createdAt: { gte: new Date(Date.now() - 86400000) },
      ...(q ? { roomId: q } : {}),
    };
    const [messages, total] = await Promise.all([
      db.chatMessage.findMany({
        where,
        ...paging,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          roomId: true,
          sessionId: true,
          userId: true,
          content: true,
          createdAt: true,
          removedAt: true,
          user: { select: { nickname: true } },
        },
      }),
      db.chatMessage.count({ where }),
    ]);
    return {
      items: messages.map(({ user, ...m }) => ({
        ...m,
        content: m.removedAt ? '消息已移除' : m.content,
        nickname: user.nickname,
      })),
      total,
      page,
      pageSize,
    };
  }
  if (kind === 'audits') {
    const where = q ? { OR: [{ actorId: q }, { targetId: q }] } : {};
    const [items, total] = await Promise.all([
      db.adminAudit.findMany({
        where,
        ...paging,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db.adminAudit.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  throw new AppError('NOT_FOUND', '管理页面不存在', 404);
}
export async function adminOverview(metrics: {
  connections: number;
  onlineUsers: number;
  roomIds: string[];
}) {
  const [
    users,
    bannedUsers,
    publicRooms,
    ongoingSessions,
    endedSessions,
    retainedMessages,
    activeRooms,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { bannedAt: { not: null } } }),
    db.room.count({ where: { visibility: 'PUBLIC', session: { phase: { not: 'ENDED' } } } }),
    db.studySession.count({ where: { phase: { not: 'ENDED' } } }),
    db.studySession.count({ where: { phase: 'ENDED' } }),
    db.chatMessage.count({
      where: { removedAt: null, createdAt: { gte: new Date(Date.now() - 86400000) } },
    }),
    db.room.count({ where: { id: { in: metrics.roomIds }, session: { phase: { not: 'ENDED' } } } }),
  ]);
  return {
    connections: metrics.connections,
    onlineUsers: metrics.onlineUsers,
    activeRooms,
    users,
    bannedUsers,
    publicRooms,
    ongoingSessions,
    endedSessions,
    retainedMessages,
  };
}
// Preview fingerprints only data relevant to the impact; heartbeats and timer revisions do not invalidate it.
export async function adminImpact(
  action: AdminAction['action'],
  targetId: string,
  tx: Tx = db,
): Promise<AdminImpact> {
  let state: unknown;
  let description: string;
  if (action.startsWith('user:')) {
    const user = await tx.user.findUnique({ where: { id: targetId }, select: userSelect });
    if (!user) throw new AppError('NOT_FOUND', '用户不存在', 404);
    const memberships = await tx.roomMember.findMany({
      where: { userId: targetId, leftAt: null, room: { session: { phase: { not: 'ENDED' } } } },
      select: {
        room: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { leftAt: null },
              orderBy: { userId: 'asc' },
              select: {
                userId: true,
                afk: true,
                connectionState: true,
                user: { select: { bannedAt: true } },
              },
            },
          },
        },
      },
    });
    const sessions = await tx.authSession.count({
      where: { userId: targetId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    const admins = await tx.user.count({ where: { role: 'ADMIN', bannedAt: null } });
    state = { user, memberships, sessions, admins };
    description =
      action === 'user:ban'
        ? '封禁 ' +
          user.username +
          '；撤销 ' +
          sessions +
          ' 个登录会话，关闭全部标签连接，移除 ' +
          memberships.length +
          ' 个进行中房间的成员资格。若为房主，按规则接任；无人可接任时结算全房。涉及房间成员共 ' +
          memberships.reduce((n, m) => n + m.room.members.length, 0) +
          ' 人。'
        : '解封 ' + user.username + '；需重新登录，不恢复旧令牌、座位或房主身份。';
  } else if (action.startsWith('room:')) {
    const room = await tx.room.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        visibility: true,
        delistedAt: true,
        ownerId: true,
        session: { select: { id: true, endedAt: true } },
        members: { where: { leftAt: null }, orderBy: { userId: 'asc' }, select: { userId: true } },
      },
    });
    if (!room) throw new AppError('NOT_FOUND', '房间不存在', 404);
    state = room;
    description =
      action === 'room:delist'
        ? '下架后转为私有，停止公开展示和公开加入；现有 ' +
          room.members.length +
          ' 名成员可继续。本场不能重新公开。'
        : '结束 Session ' +
          room.session.id +
          '，结算全房 ' +
          room.members.length +
          ' 名当前成员及曾参与成员；关闭本场共学。历史记录不能手动修改。';
  } else {
    const message = await tx.chatMessage.findUnique({
      where: { id: targetId },
      select: { id: true, userId: true, roomId: true, createdAt: true, removedAt: true },
    });
    if (!message || message.createdAt.getTime() < Date.now() - 86400000)
      throw new AppError('NOT_FOUND', '消息不存在或已过期', 404);
    state = message;
    description =
      '移除这条消息原文及发送回执中的原文；已连接房间客户端与后续查询同步隐藏。此操作不能撤销。';
  }
  return { impactKey: digest(JSON.stringify(state)), description };
}
export async function adminMutate(actorId: string, raw: unknown) {
  const input = adminActionSchema.parse(raw);
  try {
    return await db.$transaction(
      async (tx) => {
        const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
        if (actor.role !== 'ADMIN' || actor.bannedAt)
          throw new AppError('FORBIDDEN', '管理员权限已失效', 403);
        return receipt(tx, actorId, input.requestId, 'admin:action', input, async () => {
          const impact = await adminImpact(input.action, input.targetId, tx);
          if (impact.impactKey !== input.impactKey)
            throw new AppError('IMPACT_CHANGED', '影响范围已变化，请重新预览并确认', 409);
          const now = new Date();
          const roomIds: string[] = [];
          let revokedUserId: string | undefined;
          const changes: Record<string, unknown> = {};
          const ownership: { roomId: string; before: string; after: string; phase: string }[] = [];
          if (input.action === 'user:ban' || input.action === 'user:unban') {
            const target = await tx.user.findUniqueOrThrow({ where: { id: input.targetId } });
            changes.account = {
              before: target.bannedAt ? 'BANNED' : 'ACTIVE',
              after: input.action === 'user:ban' ? 'BANNED' : 'ACTIVE',
            };
            if (input.action === 'user:ban') {
              if (
                target.role === 'ADMIN' &&
                !target.bannedAt &&
                (await tx.user.count({ where: { role: 'ADMIN', bannedAt: null } })) <= 1
              )
                throw new AppError('LAST_ADMIN', '不能封禁最后一个可用管理员', 409);
              await tx.user.update({
                where: { id: target.id },
                data: { bannedAt: now, banReason: input.reason },
              });
              await tx.authSession.updateMany({
                where: { userId: target.id, revokedAt: null },
                data: { revokedAt: now },
              });
              const memberships = await tx.roomMember.findMany({
                where: {
                  userId: target.id,
                  leftAt: null,
                  room: { session: { phase: { not: 'ENDED' } } },
                },
              });
              for (const member of memberships) {
                const before = await tx.room.findUniqueOrThrow({
                  where: { id: member.roomId },
                  select: { ownerId: true },
                });
                await leaveMember(tx, member.roomId, target.id, 'USER_BANNED', now);
                const after = await tx.room.findUniqueOrThrow({
                  where: { id: member.roomId },
                  select: { ownerId: true, session: { select: { phase: true } } },
                });
                ownership.push({
                  roomId: member.roomId,
                  before: before.ownerId,
                  after: after.ownerId,
                  phase: after.session.phase,
                });
                // Even when the last owner ends the session, the banned seat loses membership.
                await tx.roomMember.update({
                  where: { id: member.id },
                  data: {
                    leftAt: now,
                    ready: false,
                    connectionState: 'DISCONNECTED',
                    reconnectDeadlineAt: null,
                  },
                });
                roomIds.push(member.roomId);
              }
              revokedUserId = target.id;
              changes.memberships = ownership;
            } else
              await tx.user.update({
                where: { id: target.id },
                data: { bannedAt: null, banReason: null },
              });
          } else if (input.action === 'room:delist') {
            await tx.room.update({
              where: { id: input.targetId },
              data: { visibility: 'PRIVATE', delistedAt: now, revision: { increment: 1 } },
            });
            roomIds.push(input.targetId);
            changes.visibility = 'PRIVATE';
            changes.delisted = true;
          } else if (input.action === 'room:end') {
            await finishSession(tx, input.targetId, 'ADMIN_ENDED', now);
            roomIds.push(input.targetId);
            const ended = await tx.room.findUniqueOrThrow({
              where: { id: input.targetId },
              select: {
                session: { select: { id: true, phase: true, endReason: true, endedAt: true } },
              },
            });
            changes.session = ended.session;
          } else {
            const message = await tx.chatMessage.findUniqueOrThrow({
              where: { id: input.targetId },
            });
            await tx.chatMessage.update({
              where: { id: message.id },
              data: { content: '', removedAt: now },
            });
            await tx.commandReceipt.updateMany({
              where: {
                userId: message.userId,
                requestId: message.requestId,
                commandType: 'chat:send',
              },
              data: { result: '{"removed":true}' },
            });
            await bump(tx, message.roomId);
            roomIds.push(message.roomId);
            changes.message = { id: message.id, contentRemoved: true };
          }
          const audit = await tx.adminAudit.create({
            data: {
              actorId,
              action: input.action,
              targetId: input.targetId,
              reason: input.reason,
              result: 'SUCCESS',
              summary: impact.description + ' 变更：' + JSON.stringify(changes),
              requestId: input.requestId,
            },
          });
          return { auditId: audit.id, roomIds, revokedUserId };
        });
      },
      { timeout: 60000 },
    );
  } catch (error) {
    // A failed transaction has no SUCCESS audit and no partial business changes.
    await db.adminAudit.create({
      data: {
        actorId,
        action: input.action,
        targetId: input.targetId,
        reason: input.reason,
        result: 'FAILED',
        summary: error instanceof AppError ? error.code : 'TRANSACTION_FAILED',
        requestId: input.requestId,
      },
    });
    throw error;
  }
}
