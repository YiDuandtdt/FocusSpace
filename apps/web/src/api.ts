import type { ApiError } from '@focusspace/shared';
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new RequestError('NETWORK_ERROR', '连接超时或网络不可用，请检查连接后重试');
  }
  const result = await response
    .json()
    .catch(() => ({ error: { code: 'SERVER_ERROR', message: '服务暂时不可用，请稍后重试' } }));
  if (!response.ok) {
    const error = result.error as ApiError;
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('focusspace:unauthorized'));
    throw new RequestError(error.code, error.message);
  }
  return result as T;
}
export async function roomRequest(path: string, body: unknown) {
  try {
    return await api<{ roomId: string }>(path, { method: 'POST', body });
  } catch (error) {
    if (error instanceof RequestError && error.code === 'NETWORK_ERROR')
      return api<{ roomId: string }>(path, { method: 'POST', body });
    throw error;
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试';
