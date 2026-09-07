import { createHash, randomBytes } from 'node:crypto';
import { parse, serialize as cookie } from 'cookie';
import { compare, hash } from 'bcryptjs';
import type { User as DbUser } from '@prisma/client';
import type { User } from '@focusspace/shared';
import { db, serialize } from '../db.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export const cookieName = 'focusspace_session';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const publicUser = (user: DbUser): User => ({
  id: user.id,
  username: user.username,
  nickname: user.nickname,
  avatarId: user.avatarId as User['avatarId'],
  role: user.role,
});
export async function authenticate(header?: string) {
  const token = parse(header ?? '')[cookieName];
  const session = token
    ? await db.authSession.findUnique({
        where: { tokenHash: digest(token) },
        include: { user: true },
      })
    : null;
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now())
    throw new AppError('UNAUTHORIZED', '登录已失效，请重新登录', 401);
  return session;
}
export async function register(input: {
  username: string;
  password: string;
  nickname: string;
  avatarId: string;
}) {
  if (Buffer.byteLength(input.password, 'utf8') > 72)
    throw new AppError('VALIDATION_ERROR', '密码 UTF-8 长度不能超过 72 字节');
  if (await db.user.findUnique({ where: { username: input.username } }))
    throw new AppError('CONFLICT', '这个账号已被使用，请换一个', 409);
  const passwordHash = await hash(input.password, 12);
  return publicUser(
    await db.user.create({
      data: {
        username: input.username,
        nickname: input.nickname,
        avatarId: input.avatarId,
        passwordHash,
      },
    }),
  );
}
const dummyHash = await hash(randomBytes(32).toString('hex'), 12);
export async function login(username: string, password: string) {
  const user = await db.user.findUnique({ where: { username } });
  const matches = await compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !matches || Buffer.byteLength(password, 'utf8') > 72)
    throw new AppError('UNAUTHORIZED', '账号或密码不正确', 401);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86400000);
  await serialize(() =>
    db.authSession.create({ data: { tokenHash: digest(token), userId: user.id, expiresAt } }),
  );
  return { user: publicUser(user), cookie: sessionCookie(token, expiresAt) };
}
export function sessionCookie(token: string, expires: Date) {
  return cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires,
  });
}
