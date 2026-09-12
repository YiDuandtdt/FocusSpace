import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const origin = new URL(process.argv[2]);
if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(origin.hostname) || origin.port || origin.username || origin.password) throw new Error('Expected an HTTPS TryCloudflare URL');
let source = readFileSync('.env', 'utf8');
const env = parseEnv(source);
const port = Number(env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
for (const [key, value] of Object.entries({ PORT: String(port), HOST: '127.0.0.1', APP_ORIGINS: origin.origin, COOKIE_SECURE: 'true', DEMO_MODE: 'false' })) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'gm');
  source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : source.trimEnd() + `\n${key}=${value}\n`;
}
mkdirSync('.tmp', { recursive: true });
writeFileSync('.tmp/public.env', source);
console.log(JSON.stringify({ port, url: origin.origin }));
