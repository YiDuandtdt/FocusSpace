import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function publicError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof ZodError)
    return { code: 'VALIDATION_ERROR', message: error.issues[0]?.message ?? '请检查输入' };
  // Prisma messages can include query arguments (private task/chat text).
  console.error({
    name: error instanceof Error ? error.name : 'UnknownError',
    code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
  });
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError
  )
    return {
      code: 'DATABASE_UNAVAILABLE',
      message: '数据暂时无法保存或读取。请重试连接，核对当前结果后继续操作；输入内容已保留。',
    };
  return { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' };
}
