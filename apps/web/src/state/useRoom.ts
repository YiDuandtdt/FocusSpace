import { createRequestId } from '../requestId';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  RoomCommand,
  RoomEvent,
  RoomSnapshot,
  ChatEvent,
  ChatMessage,
  LightEvent,
} from '@focusspace/shared';
import { api, errorMessage, RequestError } from '../api';

import { readDraft, writeDraft, getDraftEpoch } from '../preferences';
import { mergeMessages } from './messages';

export function useRoom(roomId: string, userId: string) {
  const draftKey = userId + ':' + roomId + ':pending';
  const [lights, setLights] = useState<LightEvent[]>([]);
  const latestRevision = useRef(-1);
  const [data, setData] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const clock = useRef({ serverAt: Date.now(), localAt: performance.now() });
  const calibrate = useCallback((serverTime: number, sentAt: number) => {
    const receivedAt = performance.now();
    clock.current = { serverAt: serverTime + (receivedAt - sentAt) / 2, localAt: receivedAt };
  }, []);
  const serverNow = useCallback(
    () => clock.current.serverAt + performance.now() - clock.current.localAt,
    [],
  );
  const syncRef = useRef<() => void>(() => undefined);
  const syncNow = useCallback(() => syncRef.current(), []);
  const socketRef = useRef<Socket | null>(null);
  const pendingCommands = useRef(
    new Map<string, { requestId: string; roomId: string; payload: unknown }>(),
  );
  const accept = useCallback((incoming: RoomSnapshot) => {
    if (incoming.revision < latestRevision.current) return;
    latestRevision.current = incoming.revision;
    setData(incoming);
    setMessages(mergeMessages([], incoming.recentMessages, incoming.serverTime));
  }, []);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    setRemoved(false);
    setStatus('connecting');
    setMessages([]);
    latestRevision.current = -1;
    setLights([]);
    pendingCommands.current = new Map(readDraft(draftKey, []));
    const socket = io({
      autoConnect: false,
      withCredentials: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    let syncing = false;
    let terminal = false;
    const expire = () => {
      if (alive) window.dispatchEvent(new Event('focusspace:unauthorized'));
    };
    const removed = (detail?: { message: string }) => {
      if (alive) {
        terminal = true;
        setRemoved(true);
        setStatus('offline');
        setError(detail?.message ?? '你已离开这个房间');
      }
    };
    function sync(type: 'room:join' | 'room:sync' = 'room:sync') {
      if (!alive || terminal || syncing) return;
      if (!socket.connected) {
        socket.connect();
        return;
      }
      syncing = true;
      const sentAt = performance.now();
      socket
        .timeout(8000)
        .emit(
          type,
          { requestId: createRequestId(), roomId, payload: {} },
          (error: Error | null, ack: Ack) => {
            syncing = false;
            if (!alive) return;
            if (error) {
              setStatus('offline');
              setError('状态同步超时，正在重新连接…');
              socket.disconnect().connect();
              return;
            }
            if (!ack.ok) {
              if (ack.error?.code === 'UNAUTHORIZED') expire();
              else if (ack.error?.code === 'ROOM_NOT_FOUND') removed(ack.error);
              else {
                setStatus('offline');
                setError(ack.error?.message ?? '状态同步失败，请重试连接');
              }
              return;
            }
            if (ack.data) {
              calibrate(ack.data.serverTime, sentAt);
              accept(ack.data);
            }
            setStatus('online');
            setError('');
          },
        );
    }
    syncRef.current = sync;
    socket.on('connect', () => sync('room:join'));
    socket.on('disconnect', () => {
      syncing = false;
      if (alive) {
        setStatus('offline');
        setLights([]);
        setMessages([]);
        setData((old) =>
          old ? { ...old, members: old.members.map((m) => ({ ...m, publicTasks: [] })) } : old,
        );
      }
    });
    socket.on('connect_error', (error: Error) => {
      if (!alive) return;
      setStatus('offline');
      if (error.message === 'UNAUTHORIZED') expire();
      else setError('暂时无法连接房间，正在重试…');
    });
    socket.on('room:snapshot', (event: RoomEvent) => {
      if (alive && event.roomId === roomId) accept(event.data);
    });
    const seen = new Set<string>();
    socket.on('chat:message', (event: ChatEvent) => {
      if (!alive || event.roomId !== roomId || event.revision < latestRevision.current) return;
      setMessages((old) => mergeMessages(old, [event.data], event.serverTime));
    });
    socket.on('room:light', (event: LightEvent) => {
      if (
        !alive ||
        event.roomId !== roomId ||
        seen.has(event.eventId) ||
        serverNow() - event.createdAt > 4000
      )
        return;
      seen.add(event.eventId);
      if (seen.size > 300) seen.delete(seen.values().next().value!);
      setLights((old) => [...old.filter((e) => e.userId !== event.userId), event].slice(-8));
    });
    const lightTimer = setInterval(
      () =>
        setLights((old) =>
          old.length ? old.filter((e) => serverNow() - e.createdAt < 4000) : old,
        ),
      500,
    );
    socket.on('auth:expired', expire);
    socket.on('room:removed', removed);
    socket.on('room:error', (detail: { message: string }) => {
      if (alive) {
        setStatus('offline');
        setError(detail.message);
      }
    });
    // Read persisted membership first. Opening a URL never grants a seat.
    const sentAt = performance.now();
    void api<RoomSnapshot>(`/rooms/${roomId}/snapshot`)
      .then((snapshot) => {
        if (!alive) return;
        calibrate(snapshot.serverTime, sentAt);
        accept(snapshot);
        socket.connect();
      })
      .catch((error) => {
        if (alive) {
          setError(errorMessage(error));
          setStatus('offline');
          if (error instanceof RequestError && error.code === 'ROOM_NOT_FOUND')
            removed({ message: error.message });
          else if (!(error instanceof RequestError && error.code === 'UNAUTHORIZED'))
            socket.connect();
        }
      });
    const interval = setInterval(() => sync(), 10000);
    const visible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', syncNow);
    return () => {
      alive = false;
      clearInterval(interval);
      clearInterval(lightTimer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', syncNow);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      syncRef.current = () => undefined;
    };
  }, [roomId, userId, draftKey, accept, calibrate, syncNow, serverNow]);
  const command = async (type: RoomCommand, payload: unknown = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected || status !== 'online') throw new Error('连接尚未恢复，请稍后操作');
    const draftEpoch = getDraftEpoch();
    const key = type + ':' + JSON.stringify(payload);
    // A failed acknowledgement can follow a committed write. Manual retry must
    // use the same receipt, including chat (which is never auto-sent on reconnect).
    const input = pendingCommands.current.get(key) ?? {
      requestId: createRequestId(),
      roomId,
      payload,
    };
    pendingCommands.current.set(key, input);
    writeDraft(draftKey, [...pendingCommands.current].slice(-100), draftEpoch);
    const send = () =>
      new Promise<Ack>((resolve, reject) => {
        if (!socket.connected) {
          reject(new Error('连接已断开，草稿已保留'));
          return;
        }
        socket
          .timeout(8000)
          .emit(type, input, (error: Error | null, ack: Ack) =>
            error ? reject(error) : resolve(ack),
          );
      });
    let ack: Ack;
    try {
      ack = await send();
    } catch {
      // Confirm committed state, then retry the same idempotency key once.
      const fresh = await api<RoomSnapshot>(`/rooms/${roomId}/snapshot`).catch(() => null);
      if (fresh) accept(fresh);
      if (type === 'chat:send' || type === 'reaction:send')
        throw new Error('消息确认超时，请检查聊天区；草稿已保留，不会自动补发');
      try {
        ack = await send();
      } catch {
        throw new Error('操作确认超时，状态已尝试同步，请检查当前结果后重试');
      }
    }
    if (!ack.ok) {
      if (!['DATABASE_UNAVAILABLE', 'INTERNAL_ERROR'].includes(ack.error?.code ?? ''))
        pendingCommands.current.delete(key);
      writeDraft(draftKey, [...pendingCommands.current], draftEpoch);
      syncNow();
      throw new Error(ack.error?.message ?? '操作未完成');
    }
    pendingCommands.current.delete(key);
    writeDraft(draftKey, [...pendingCommands.current], draftEpoch);
    if (ack.data) accept(ack.data);
  };
  return { data, status, error, removed, command, messages, lights, serverNow, syncNow };
}
