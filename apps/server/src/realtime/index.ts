import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  commandSchema,
  rhythmSchema,
  type Ack,
  type RoomCommand,
  type RoomEvent,
} from '@focusspace/shared';
import { db, serialize } from '../db.js';
import { config } from '../config.js';
import { AppError, publicError } from '../errors.js';
import { authenticate } from '../modules/auth.js';
import {
  leaveMember,
  mutateMember,
  requireMember,
  setConnected,
  snapshot,
} from '../modules/room.js';

export function createRealtime(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: [...config.origins], credentials: true },
    allowRequest: (req, done) => {
      // Browsers omit Origin on same-origin polling GETs. Fetch Metadata plus
      // the same-origin Referer validates that transport without opening CORS.
      let origin = req.headers.origin;
      if (!origin && req.headers['sec-fetch-site'] === 'same-origin' && req.headers.referer) {
        try {
          origin = new URL(req.headers.referer).origin;
        } catch {
          /* Reject malformed headers below. */
        }
      }
      done(null, !!origin && config.origins.has(origin));
    },
    maxHttpBufferSize: 16384,
    pingInterval: 10000,
    pingTimeout: 10000,
  });
  const subscriptions = new Map<
    string,
    { socket: Socket; userId: string; roomId: string; authId: string }
  >();
  const hasConnection = (roomId: string, userId: string) =>
    [...subscriptions.values()].some(
      (s) => s.roomId === roomId && s.userId === userId && s.socket.connected,
    );
  async function broadcast(roomId: string, type = 'member:updated') {
    let presenceChanged = false;
    for (const entry of [...subscriptions.values()].filter((s) => s.roomId === roomId)) {
      try {
        await authenticate(entry.socket.request.headers.cookie);
        const data = await snapshot(roomId, entry.userId);
        const event: RoomEvent = {
          eventId: randomUUID(),
          roomId,
          sessionId: data.session.id,
          revision: data.revision,
          serverTime: data.serverTime,
          type,
          data,
        };
        entry.socket.emit('room:snapshot', event);
      } catch (error) {
        const detail = publicError(error);
        entry.socket.emit(detail.code === 'UNAUTHORIZED' ? 'auth:expired' : 'room:removed', detail);
        subscriptions.delete(entry.socket.id);
        if (detail.code === 'UNAUTHORIZED') {
          if (!hasConnection(roomId, entry.userId)) {
            await setConnected(roomId, entry.userId, false);
            presenceChanged = true;
          }
          entry.socket.disconnect(true);
        }
      }
    }
    if (presenceChanged) await broadcast(roomId, type);
  }
  io.use(async (socket, next) => {
    try {
      const auth = await authenticate(socket.request.headers.cookie);
      socket.data.userId = auth.userId;
      socket.data.authId = auth.id;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });
  io.on('connection', (socket) => {
    let windowStart = Date.now();
    let commandCount = 0;
    const commands: RoomCommand[] = [
      'room:join',
      'room:sync',
      'member:ready',
      'member:afk',
      'member:leave',
      'room:configure',
    ];
    for (const type of commands)
      socket.on(type, (raw: unknown, respond?: (result: Ack) => void) => {
        if (typeof respond !== 'function') return;
        void serialize(async () => {
          let requestId = '';
          try {
            if (Date.now() - windowStart > 10000) {
              windowStart = Date.now();
              commandCount = 0;
            }
            if (++commandCount > 60)
              throw new AppError('RATE_LIMITED', '操作太快，请稍后重试', 429);
            const auth = await authenticate(socket.request.headers.cookie);
            const input = commandSchema.parse(raw);
            requestId = input.requestId;
            if (!socket.connected) return;
            if (type === 'room:join' || type === 'room:sync') {
              await requireMember(input.roomId, auth.userId, db, true);
              const previous = subscriptions.get(socket.id);
              if (previous && previous.roomId !== input.roomId) {
                subscriptions.delete(socket.id);
                if (!hasConnection(previous.roomId, auth.userId))
                  await setConnected(previous.roomId, auth.userId, false);
                await broadcast(previous.roomId);
              }
              subscriptions.set(socket.id, {
                socket,
                userId: auth.userId,
                roomId: input.roomId,
                authId: auth.id,
              });
              await setConnected(input.roomId, auth.userId, true);
            } else {
              if (type !== 'member:leave' && subscriptions.get(socket.id)?.roomId !== input.roomId)
                throw new AppError('FORBIDDEN', '请先连接房间', 403);
              const payload =
                type === 'member:ready'
                  ? z.object({ ready: z.boolean() }).parse(input.payload)
                  : type === 'member:afk'
                    ? z.object({ afk: z.boolean() }).parse(input.payload)
                    : type === 'room:configure'
                      ? rhythmSchema.parse(input.payload)
                      : z.object({}).strict().parse(input.payload);
              await mutateMember(auth.userId, input.roomId, requestId, type, payload);
            }
            await broadcast(input.roomId, type);
            const data =
              type === 'member:leave' ? undefined : await snapshot(input.roomId, auth.userId);
            respond({ requestId, ok: true, revision: data?.revision, data });
          } catch (error) {
            respond({ requestId, ok: false, error: publicError(error) });
          }
        });
      });
    socket.on('disconnect', () => {
      void serialize(async () => {
        const entry = subscriptions.get(socket.id);
        subscriptions.delete(socket.id);
        if (entry && !hasConnection(entry.roomId, entry.userId)) {
          try {
            await setConnected(entry.roomId, entry.userId, false);
            await broadcast(entry.roomId);
          } catch (error) {
            if (!(error instanceof AppError)) console.error(error);
          }
        }
      }).catch(console.error);
    });
  });
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void serialize(async () => {
      const changed = new Set<string>();
      for (const entry of [...subscriptions.values()]) {
        try {
          await authenticate(entry.socket.request.headers.cookie);
        } catch {
          entry.socket.emit('auth:expired');
          entry.socket.disconnect(true);
        }
      }
      const stale = await db.roomMember.findMany({
        where: {
          leftAt: null,
          connectionState: 'DISCONNECTED',
          lastSeenAt: { lte: new Date(Date.now() - config.DISCONNECT_GRACE_MS) },
          room: { session: { phase: { not: 'ENDED' } } },
        },
      });
      for (const member of stale) {
        if (hasConnection(member.roomId, member.userId)) continue;
        await db.$transaction((tx) =>
          leaveMember(tx, member.roomId, member.userId, 'OWNER_DISCONNECTED'),
        );
        changed.add(member.roomId);
      }
      for (const roomId of changed) await broadcast(roomId, 'member:left');
    })
      .catch(console.error)
      .finally(() => {
        sweeping = false;
      });
  }, 1000);
  const heartbeat = setInterval(() => {
    void serialize(async () => {
      const active = [...subscriptions.values()].filter((s) => s.socket.connected);
      if (active.length)
        await db.roomMember.updateMany({
          where: {
            leftAt: null,
            connectionState: 'CONNECTED',
            OR: active.map((s) => ({ roomId: s.roomId, userId: s.userId })),
          },
          data: { lastSeenAt: new Date() },
        });
      await db.commandReceipt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } },
      });
    }).catch(console.error);
  }, 15000);
  return {
    io,
    broadcast,
    revoke(authId: string) {
      for (const socket of io.sockets.sockets.values())
        if (socket.data.authId === authId) {
          socket.emit('auth:expired');
          socket.disconnect(true);
        }
    },
    close() {
      clearInterval(sweep);
      clearInterval(heartbeat);
      io.close();
    },
  };
}
