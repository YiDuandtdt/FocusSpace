import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
mkdirSync('prisma/data', { recursive: true });
console.log('Local environment ready. Existing settings and data are preserved.');
