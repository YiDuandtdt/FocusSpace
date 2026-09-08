import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  commandSchema,
  rhythmSchema,
  demoRhythmSchema,
  type Ack,
  type RoomCommand,
  type RoomEvent,
  type ChatMessage,
  type ChatEvent,
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
import { advanceRoom, reconnectDeadline, sessionCommand } from '../modules/session.js';
import { retainData } from '../modules/retention.js';
import { taskCommand } from '../modules/task.js';
import { sendChat } from '../modules/chat.js';

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
    pingInterval: 15000,
    pingTimeout: 10000,
  });
  const subscriptions = new Map<
    string,
    { socket: Socket; userId: string; roomId: string; authId: string; lastSeenAt: number }
  >();
  const hasConnection = (roomId: string, userId: string) =>
    [...subscriptions.values()].some(
      (s) => s.roomId === roomId && s.userId === userId && s.socket.connected,
    );
  // Keep failed disconnect writes until committed; a reconnect must close the old interval first.
  const disconnections = new Map<string, { roomId: string; userId: string; at: Date }>();
  const reportUnavailable = (error: unknown) => io.emit('room:error', publicError(error));
  async function flushDisconnects() {
    for (const [key, entry] of disconnections) {
      try {
        await setConnected(entry.roomId, entry.userId, false, entry.at);
      } catch (error) {
        if (!(error instanceof AppError && error.code === 'ROOM_NOT_FOUND')) throw error;
      }
      disconnections.delete(key);
    }
  }
  async function broadcast(roomId: string, type = 'member:updated', message?: ChatMessage) {
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
        if (message && data.myPermissions.canParticipate) {
          const chat: ChatEvent = {
            ...event,
            eventId: message.id,
            type: 'chat:message',
            data: message,
          };
          entry.socket.emit('chat:message', chat);
        }
      } catch (error) {
        const detail = publicError(error);
        if (!['UNAUTHORIZED', 'ROOM_NOT_FOUND'].includes(detail.code)) {
          entry.socket.emit('room:error', detail);
          continue;
        }
        entry.socket.emit(detail.code === 'UNAUTHORIZED' ? 'auth:expired' : 'room:removed', detail);
        if (detail.code === 'UNAUTHORIZED') {
          // Disconnect owns the durable presence transition, including write retries.
          entry.socket.disconnect(true);
        } else subscriptions.delete(entry.socket.id);
      }
    }
  }
  io.use(async (socket, next) => {
    try {
      const auth = await authenticate(socket.request.headers.cookie);
      socket.data.userId = auth.userId;
      socket.data.authId = auth.id;
      next();
    } catch (error) {
      next(new Error(publicError(error).code));
    }
  });
  io.on('connection', (socket) => {
    socket.conn.on('packet', (packet) => {
      if (packet.type === 'pong') {
        const entry = subscriptions.get(socket.id);
        if (entry) {
          entry.lastSeenAt = Date.now();
          const at = new Date(entry.lastSeenAt);
          void serialize(async () => {
            await db.roomMember.updateMany({
              where: {
                roomId: entry.roomId,
                userId: entry.userId,
                leftAt: null,
                connectionState: 'CONNECTED',
                lastSeenAt: { lt: at },
                room: { session: { phase: { not: 'ENDED' } } },
              },
              data: { lastSeenAt: at },
            });
          }).catch(reportUnavailable);
        }
      }
    });
    let windowStart = Date.now();
    let commandCount = 0;
    const commands: RoomCommand[] = [
      'room:join',
      'room:sync',
      'member:ready',
      'member:afk',
      'member:leave',
      'room:configure',
      'session:start',
      'session:end',
      'task:create',
      'task:update',
      'task:delete',
      'chat:send',
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
            await flushDisconnects();
            const entry = subscriptions.get(socket.id);
            if (entry) entry.lastSeenAt = Date.now();
            await requireMember(input.roomId, auth.userId, db, true).catch((error) => {
              // Leave retries remain valid after the member has left.
              if (type !== 'member:leave') throw error;
            });
            if (await advanceRoom(input.roomId)) await broadcast(input.roomId, 'phase:change');
            let message: ChatMessage | undefined;
            if (type === 'room:join' || type === 'room:sync') {
              await requireMember(input.roomId, auth.userId, db, true);
              const previous = subscriptions.get(socket.id);
              if (previous && previous.roomId !== input.roomId) {
                subscriptions.delete(socket.id);
                if (!hasConnection(previous.roomId, auth.userId)) {
                  disconnections.set(previous.roomId + ':' + auth.userId, {
                    roomId: previous.roomId,
                    userId: auth.userId,
                    at: new Date(),
                  });
                  await flushDisconnects();
                }
                await broadcast(previous.roomId);
              }
              await setConnected(input.roomId, auth.userId, true);
              subscriptions.set(socket.id, {
                socket,
                userId: auth.userId,
                roomId: input.roomId,
                authId: auth.id,
                lastSeenAt: Date.now(),
              });
            } else {
              if (type !== 'member:leave' && subscriptions.get(socket.id)?.roomId !== input.roomId)
                throw new AppError('FORBIDDEN', '请先连接房间', 403);
              if (type === 'session:start' || type === 'session:end') {
                z.object({}).strict().parse(input.payload);
                await sessionCommand(auth.userId, input.roomId, requestId, type);
              } else if (type.startsWith('task:')) {
                await taskCommand(auth.userId, input.roomId, requestId, type, input.payload);
              } else if (type === 'chat:send') {
                message = await sendChat(auth.userId, input.roomId, requestId, input.payload);
              } else {
                const payload =
                  type === 'member:ready'
                    ? z.object({ ready: z.boolean() }).parse(input.payload)
                    : type === 'member:afk'
                      ? z.object({ afk: z.boolean() }).parse(input.payload)
                      : type === 'room:configure'
                        ? (config.DEMO_MODE === 'true'
                            ? z.union([rhythmSchema, demoRhythmSchema])
                            : rhythmSchema
                          ).parse(input.payload)
                        : z.object({}).strict().parse(input.payload);
                await mutateMember(auth.userId, input.roomId, requestId, type, payload);
              }
            }
            await broadcast(input.roomId, type, message);
            const data =
              type === 'member:leave' ? undefined : await snapshot(input.roomId, auth.userId);
            respond({ requestId, ok: true, revision: data?.revision, data });
          } catch (error) {
            respond({ requestId, ok: false, error: publicError(error) });
          }
        });
      });
    socket.on('disconnect', (reason) => {
      const detectedAt = new Date();
      void serialize(async () => {
        const entry = subscriptions.get(socket.id);
        subscriptions.delete(socket.id);
        if (entry && !hasConnection(entry.roomId, entry.userId)) {
          disconnections.set(`${entry.roomId}:${entry.userId}`, {
            roomId: entry.roomId,
            userId: entry.userId,
            at: reason === 'ping timeout' ? new Date(entry.lastSeenAt) : detectedAt,
          });
          try {
            await flushDisconnects();
            await advanceRoom(entry.roomId);
            await broadcast(entry.roomId);
          } catch (error) {
            if (!(error instanceof AppError)) reportUnavailable(error);
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
      await flushDisconnects();
      const changed = new Set<string>();
      const due = await db.room.findMany({
        where: { session: { phase: { in: ['FOCUS', 'BREAK'] }, phaseEndAt: { lte: new Date() } } },
      });
      for (const room of due)
        if (await advanceRoom(room.id)) await broadcast(room.id, 'phase:change');
      for (const entry of [...subscriptions.values()]) {
        try {
          await authenticate(entry.socket.request.headers.cookie);
        } catch (error) {
          if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
            entry.socket.emit('auth:expired');
            entry.socket.disconnect(true);
          } else throw error;
        }
      }
      const stale = await db.roomMember.findMany({
        where: {
          leftAt: null,
          connectionState: 'DISCONNECTED',
          room: { session: { phase: { not: 'ENDED' } } },
        },
      });
      for (const member of stale) {
        if (reconnectDeadline(member).getTime() > Date.now()) continue;
        if (hasConnection(member.roomId, member.userId)) continue;
        const current = await db.room.findUnique({
          where: { id: member.roomId },
          include: { session: true },
        });
        if (current?.session.phase === 'ENDED') continue;
        if (current?.ownerId === member.userId) await advanceRoom(member.roomId);
        else
          await db.$transaction((tx) =>
            leaveMember(tx, member.roomId, member.userId, 'DISCONNECTED'),
          );
        changed.add(member.roomId);
      }
      for (const roomId of changed) await broadcast(roomId, 'member:left');
    })
      .catch(reportUnavailable)
      .finally(() => {
        sweeping = false;
      });
  }, 1000);
  const heartbeat = setInterval(() => {
    void serialize(async () => {
      const active = [...subscriptions.values()].filter((s) => s.socket.connected);
      const seen = new Map<string, (typeof active)[number]>();
      for (const entry of active) {
        const key = `${entry.roomId}:${entry.userId}`;
        if (!seen.has(key) || seen.get(key)!.lastSeenAt < entry.lastSeenAt) seen.set(key, entry);
      }
      for (const entry of seen.values())
        await db.roomMember.updateMany({
          where: {
            roomId: entry.roomId,
            userId: entry.userId,
            leftAt: null,
            connectionState: 'CONNECTED',
            room: { session: { phase: { not: 'ENDED' } } },
          },
          data: { lastSeenAt: new Date(entry.lastSeenAt) },
        });
    }).catch(reportUnavailable);
  }, 15000);
  const retention = setInterval(() => {
    void serialize(() => retainData()).catch(reportUnavailable);
  }, 60000);
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
      clearInterval(retention);
      io.close();
    },
  };
}
