import type { Prisma } from '@prisma/client';
import type { PublicRoom, RoomTheme } from '@focusspace/shared';
import { db } from '../db.js';
import { AppError } from '../errors.js';
export function pagination(query: Record<string, unknown>, size = 12) {
  const page = Number(query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new AppError('VALIDATION_ERROR', '页码无效');
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
  return { page, pageSize: size, skip: (page - 1) * size, q };
}
export async function publicRooms(query: Record<string, unknown>) {
  const { page, pageSize, skip, q } = pagination(query);
  const phase = query.phase;
  if (phase && !['LOBBY', 'FOCUS', 'BREAK'].includes(String(phase)))
    throw new AppError('VALIDATION_ERROR', '阶段筛选无效');
  const where: Prisma.RoomWhereInput = {
    visibility: 'PUBLIC',
    name: { contains: q },
    session: { phase: phase ? (phase as 'LOBBY' | 'FOCUS' | 'BREAK') : { not: 'ENDED' } },
  };
  const [total, rooms] = await Promise.all([
    db.room.count({ where }),
    db.room.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        capacity: true,
        theme: true,
        session: {
          select: { phase: true, focusSeconds: true, breakSeconds: true, phaseEndAt: true },
        },
        _count: { select: { members: { where: { leftAt: null } } } },
      },
    }),
  ]);
  const items: PublicRoom[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    theme: r.theme as RoomTheme,
    members: r._count.members,
    phase: r.session.phase,
    focusSeconds: r.session.focusSeconds,
    breakSeconds: r.session.breakSeconds,
    nextStartAt: r.session.phaseEndAt
      ? r.session.phaseEndAt.getTime() +
        (r.session.phase === 'FOCUS' ? r.session.breakSeconds * 1000 : 0)
      : null,
  }));
  return { items, total, page, pageSize };
}
