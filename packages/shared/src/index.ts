import { z } from 'zod';

export const AVATARS = ['lake', 'sage', 'lilac', 'sun'] as const;
export const ROOM_CAPACITY = 8;
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, '账号至少 3 位')
    .max(24)
    .regex(/^[a-z0-9_]+$/, '账号只能包含字母、数字和下划线'),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
});
export const profileSchema = z.object({
  nickname: z.string().trim().min(1, '请输入昵称').max(20, '昵称最多 20 字'),
  avatarId: z.enum(AVATARS),
});
export const registerSchema = credentialsSchema.extend({
  nickname: profileSchema.shape.nickname,
  avatarId: profileSchema.shape.avatarId.default('lake'),
});
export const rhythmSchema = z.object({
  focusSeconds: z.number().int().min(60).max(10800),
  breakSeconds: z.number().int().min(60).max(3600),
});
export const requestIdSchema = z.string().uuid('请求标识无效');
export const createRoomSchema = rhythmSchema.extend({
  name: z.string().trim().min(1, '请输入房间名称').max(40, '房间名最多 40 字'),
  requestId: requestIdSchema,
});
export const joinRoomSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{6}$/, '请输入 6 位房间码'),
  requestId: requestIdSchema,
});
export const commandSchema = z.object({
  requestId: requestIdSchema,
  roomId: z.string().min(1).max(100),
  payload: z.unknown(),
});
export type Phase = 'LOBBY' | 'FOCUS' | 'BREAK' | 'ENDED';
export type User = {
  id: string;
  username: string;
  nickname: string;
  avatarId: (typeof AVATARS)[number];
  role: 'USER' | 'ADMIN';
};
export type Member = {
  userId: string;
  nickname: string;
  avatarId: User['avatarId'];
  seatIndex: number;
  ready: boolean;
  afk: boolean;
  connectionState: 'CONNECTED' | 'DISCONNECTED';
  status: 'JOINED' | 'READY' | 'AFK' | 'DISCONNECTED';
  isOwner: boolean;
  joinedAt: number;
  tasksDone: number;
  tasksTotal: number;
  progressPercent: number | null;
};
export type RoomSnapshot = {
  room: { id: string; code: string; name: string; ownerId: string; capacity: number };
  session: {
    id: string;
    phase: Phase;
    roundNo: number;
    focusSeconds: number;
    breakSeconds: number;
    phaseStartAt: number | null;
    phaseEndAt: number | null;
    endedAt: number | null;
    endReason: string | null;
  };
  members: Member[];
  myTasks: never[];
  myPermissions: { isOwner: boolean; canParticipate: boolean; canConfigure: boolean };
  revision: number;
  serverTime: number;
};
export type RoomEvent = {
  eventId: string;
  roomId: string;
  sessionId: string;
  revision: number;
  serverTime: number;
  type: string;
  data: RoomSnapshot;
};
export type ApiError = { code: string; message: string };
export type Ack = {
  requestId: string;
  ok: boolean;
  revision?: number;
  data?: RoomSnapshot;
  error?: ApiError;
};
export type RoomCommand =
  | 'room:join'
  | 'room:sync'
  | 'room:configure'
  | 'member:ready'
  | 'member:afk'
  | 'member:leave';
