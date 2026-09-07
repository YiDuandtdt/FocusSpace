import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  RoomCommand,
  RoomEvent,
  RoomSnapshot,
  ChatEvent,
  ChatMessage,
} from '@focusspace/shared';
import { api, errorMessage, RequestError } from '../api';

export function useRoom(roomId: string) {
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
  const accept = useCallback(
    (incoming: RoomSnapshot) =>
      setData((old) =>
        !old || old.room.id !== incoming.room.id || incoming.revision >= old.revision
          ? incoming
          : old,
      ),
    [],
  );
  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    setRemoved(false);
    setStatus('connecting');
    setMessages([]);
    const socket = io({
      autoConnect: false,
      withCredentials: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    const expire = () => {
      if (alive) window.dispatchEvent(new Event('focusspace:unauthorized'));
    };
    const removed = (detail?: { message: string }) => {
      if (alive) {
        setRemoved(true);
        setStatus('offline');
        setError(detail?.message ?? '你已离开这个房间');
      }
    };
    function sync(type: 'room:join' | 'room:sync' = 'room:sync') {
      if (!alive || !socket.connected) return;
      const sentAt = performance.now();
      socket
        .timeout(8000)
        .emit(
          type,
          { requestId: crypto.randomUUID(), roomId, payload: {} },
          (error: Error | null, ack: Ack) => {
            if (!alive) return;
            if (error) {
              setStatus('offline');
              setError('状态同步超时，正在重新连接…');
              socket.disconnect().connect();
              return;
            }
            if (!ack.ok) {
              if (ack.error?.code === 'UNAUTHORIZED') expire();
              else removed(ack.error);
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
      if (alive) setStatus('offline');
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
      if (!alive || event.roomId !== roomId || seen.has(event.eventId)) return;
      seen.add(event.eventId);
      setMessages((old) => [...old, event.data].slice(-100));
    });
    socket.on('auth:expired', expire);
    socket.on('room:removed', removed);
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
          if (error instanceof RequestError && error.code === 'ROOM_NOT_FOUND') setRemoved(true);
        }
      });
    const interval = setInterval(() => sync(), 30000);
    const visible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      syncRef.current = () => undefined;
    };
  }, [roomId, accept, calibrate]);
  const command = async (type: RoomCommand, payload: unknown = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected || status !== 'online') throw new Error('连接尚未恢复，请稍后操作');
    const input = { requestId: crypto.randomUUID(), roomId, payload };
    const send = () =>
      new Promise<Ack>((resolve, reject) =>
        socket
          .timeout(8000)
          .emit(type, input, (error: Error | null, ack: Ack) =>
            error ? reject(error) : resolve(ack),
          ),
      );
    let ack: Ack;
    try {
      ack = await send();
    } catch {
      // Confirm committed state, then retry the same idempotency key once.
      const fresh = await api<RoomSnapshot>(`/rooms/${roomId}/snapshot`).catch(() => null);
      if (fresh) accept(fresh);
      if (type === 'chat:send')
        throw new Error('消息确认超时，请检查聊天区；草稿已保留，不会自动补发');
      try {
        ack = await send();
      } catch {
        throw new Error('操作确认超时，状态已尝试同步，请检查当前结果后重试');
      }
    }
    if (!ack.ok) {
      syncNow();
      throw new Error(ack.error?.message ?? '操作未完成');
    }
    if (ack.data) accept(ack.data);
  };
  return { data, status, error, removed, command, messages, serverNow, syncNow };
}
