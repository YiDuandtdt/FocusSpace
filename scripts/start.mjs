import { existsSync } from 'node:fs';
for (const file of ['../apps/server/dist/index.js', '../apps/web/dist/index.html']) {
  if (!existsSync(new URL(file, import.meta.url)))
    throw new Error('Production build missing. Run npm run build first.');
}
process.env.NODE_ENV = 'production';
await import('../apps/server/dist/index.js');
