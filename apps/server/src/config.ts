import { z } from 'zod';
const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.string().default('127.0.0.1'),
    APP_ORIGINS: z
      .string()
      .default(
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001',
      ),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    SESSION_DAYS: z.coerce.number().min(1).max(30).default(7),
    DISCONNECT_GRACE_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  })
  .parse(process.env);
export const config = {
  ...env,
  origins: new Set(env.APP_ORIGINS.split(',').map((s) => s.trim())),
  cookieSecure: env.COOKIE_SECURE === 'true',
};
