import { ZodError } from 'zod';
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
  console.error(error);
  return { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' };
}
