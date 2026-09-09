import { z } from 'zod';
export * from './personal.js';
import type { CharacterConfig, SpaceSnapshot } from './personal.js';

export const AVATARS = ['lake', 'sage', 'lilac', 'sun'] as const;
export const ROOM_CAPACITY = 8;
export const ROOM_THEMES = ['rain', 'night', 'library'] as const;
export type RoomTheme = (typeof ROOM_THEMES)[number];
export const roomThemeSchema = z.object({ theme: z.enum(ROOM_THEMES) }).strict();
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
export const profileSchema = z
  .object({
    nickname: z.string().trim().min(1, '请输入昵称').max(20, '昵称最多 20 字'),
    avatarId: z.enum(AVATARS),
    removeAvatar: z.boolean().optional(),
  })
  .strict();
export const registerSchema = credentialsSchema.extend({
  nickname: profileSchema.shape.nickname,
  avatarId: profileSchema.shape.avatarId.default('lake'),
});
export const rhythmSchema = z.object({
  focusSeconds: z.number().int().min(60).max(10800),
  breakSeconds: z.number().int().min(60).max(3600),
});
export const demoRhythmSchema = z.object({
  focusSeconds: z.literal(45),
  breakSeconds: z.literal(15),
});
export const taskCreateSchema = z
  .object({ title: z.string().trim().min(1, '请输入任务标题').max(200, '任务标题最多 200 字') })
  .strict();
export const taskDeleteSchema = z
  .object({ taskId: z.string().min(1).max(100), version: z.number().int().positive() })
  .strict();
export const taskUpdateSchema = taskDeleteSchema
  .extend({
    title: taskCreateSchema.shape.title.optional(),
    completed: z.boolean().optional(),
    visibility: z.enum(['PRIVATE', 'PUBLIC']).optional(),
  })
  .refine(
    (v) => v.title !== undefined || v.completed !== undefined || v.visibility !== undefined,
    '请提供修改内容',
  );
export const chatSendSchema = z
  .object({ content: z.string().trim().min(1, '请输入消息').max(500, '消息最多 500 字') })
  .strict();
export const requestIdSchema = z.string().uuid('请求标识无效');
export const createRoomSchema = rhythmSchema
  .extend({
    visibility: z.enum(['PRIVATE', 'PUBLIC']).default('PRIVATE'),
    name: z.string().trim().min(1, '请输入房间名称').max(40, '房间名最多 40 字'),
    requestId: requestIdSchema,
  })
  .strict();
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
  avatarUrl?: string | null;
  character?: CharacterConfig;
  onboarding?: 'PENDING' | 'DONE' | 'SKIPPED';
};
export type Member = {
  userId: string;
  nickname: string;
  avatarId: User['avatarId'];
  avatarUrl?: string | null;
  character?: CharacterConfig;
  seatIndex: number;
  ready: boolean;
  afk: boolean;
  connectionState: 'CONNECTED' | 'DISCONNECTED';
  status: 'JOINED' | 'READY' | 'AFK' | 'DISCONNECTED' | 'FOCUSING' | 'BREAKING' | 'ENDED';
  isOwner: boolean;
  joinedAt: number;
  lateJoin: boolean;
  tasksDone: number;
  tasksTotal: number;
  progressPercent: number | null;
  publicTasks: Pick<Task, 'id' | 'title' | 'completed'>[];
};
export type RoomSnapshot = {
  room: {
    id: string;
    code: string;
    name: string;
    ownerId: string;
    capacity: number;
    visibility: 'PRIVATE' | 'PUBLIC';
    delisted: boolean;
    theme: RoomTheme;
    spaceSnapshot?: SpaceSnapshot | null;
  };
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
    demoMode: boolean;
  };
  members: Member[];
  myTasks: Task[];
  recentMessages: ChatMessage[];
  feedback: LearningFeedback;
  myPermissions: {
    isOwner: boolean;
    canParticipate: boolean;
    canConfigure: boolean;
    canStart: boolean;
    startDisabledReason: string | null;
    canChat: boolean;
  };
  demoAvailable: boolean;
  summary: SessionSummary | null;
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
  | 'room:transfer'
  | 'room:visibility'
  | 'room:theme'
  | 'member:ready'
  | 'member:afk'
  | 'member:leave'
  | 'session:start'
  | 'session:end'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'chat:send'
  | 'reaction:send';

export type Task = {
  visibility: 'PRIVATE' | 'PUBLIC';
  id: string;
  title: string;
  completed: boolean;
  completedAt: number | null;
  version: number;
};
export type ChatMessage = {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: number;
};
export type ChatEvent = {
  eventId: string;
  roomId: string;
  sessionId: string;
  revision: number;
  serverTime: number;
  type: 'chat:message';
  data: ChatMessage;
};
export type SessionSummary = {
  sessionId: string;
  roomId: string;
  roomName: string;
  startedAt: number | null;
  endedAt: number;
  endReason: string | null;
  roomRoundsCompleted: number;
  recordAvailable: boolean;
  demoMode: boolean;
  roomFocusSeconds: number | null;
  record: {
    focusSeconds: number;
    roundsCompleted: number;
    tasksDone: number;
    tasksTotal: number;
    progressPercent: number | null;
    studiedWith: number;
  };
};

export type LearningFeedback = {
  roundNo: number;
  roundFocusSeconds: number;
  focusSeconds: number;
  roundTasksDone: number | null;
  roomFocusSeconds: number;
  roomTasksDone: number;
  roomTasksTotal: number;
};
export type LightEvent = {
  eventId: string;
  roomId: string;
  sessionId: string;
  userId: string;
  symbol: '🌱' | '💪' | '☕' | '✓';
  createdAt: number;
};
export type HistoryPage = {
  items: SessionSummary[];
  page: number;
  total: number;
  totals: {
    sessions: number;
    focusSeconds: number;
    roundsCompleted: number;
    tasksDone: number;
    tasksTotal: number;
  };
  demoSessions: number;
};

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export type PublicRoom = {
  theme: RoomTheme;
  id: string;
  name: string;
  members: number;
  capacity: number;
  phase: Phase;
  focusSeconds: number;
  breakSeconds: number;
  nextStartAt: number | null;
};
export type AdminUser = {
  id: string;
  username: string;
  nickname: string;
  role: User['role'];
  bannedAt: string | null;
  banReason: string | null;
  createdAt: string;
};
export type AdminRoom = {
  id: string;
  name: string;
  ownerId: string;
  visibility: string;
  delistedAt: string | null;
  capacity: number;
  session: {
    id: string;
    phase: Phase;
    roundNo: number;
    focusSeconds: number;
    breakSeconds: number;
    endedAt: string | null;
    endReason: string | null;
  };
  members: {
    userId: string;
    nickname: string;
    seatIndex: number;
    connectionState: string;
    afk: boolean;
  }[];
};
export type AdminMessage = {
  id: string;
  roomId: string;
  sessionId: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
  removedAt: string | null;
};
export type Audit = {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  createdAt: string;
  result: string;
  summary: string;
  requestId: string;
};
export type AdminOverview = {
  connections: number;
  onlineUsers: number;
  activeRooms: number;
  users: number;
  bannedUsers: number;
  publicRooms: number;
  ongoingSessions: number;
  endedSessions: number;
  retainedMessages: number;
};
export const adminActionSchema = z
  .object({
    action: z.enum(['user:ban', 'user:unban', 'room:delist', 'room:end', 'message:remove']),
    targetId: z.string().min(1).max(100),
    reason: z.string().trim().min(2, '请说明至少两个字的原因').max(300),
    requestId: requestIdSchema,
    impactKey: z.string().min(1).max(100),
  })
  .strict();
export type AdminAction = z.infer<typeof adminActionSchema>;
export type AdminImpact = { impactKey: string; description: string };
