import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
let source = readFileSync('.env', 'utf8');
const env = parseEnv(source);
if (env.COOKIE_SECURE === 'true') throw new Error('HTTPS is configured. Use your existing HTTPS deployment instead of the HTTP LAN launcher.');
const port = Number(env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT in .env');
const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => a.address))];
if (!addresses.length) throw new Error('No LAN IPv4 address found. Connect to Wi-Fi or Ethernet first.');
const urls = addresses.map(address => `http://${address}:${port}`);
const origins = [...new Set([...(env.APP_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean), `http://localhost:${port}`, `http://127.0.0.1:${port}`, ...urls])];
for (const [key, value] of Object.entries({ HOST: '0.0.0.0', PORT: String(port), APP_ORIGINS: origins.join(','), COOKIE_SECURE: 'false' })) {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'gm');
  source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : source.trimEnd() + `\n${key}=${value}\n`;
}
if (source !== readFileSync('.env', 'utf8')) {
  if (!existsSync('.env.local')) copyFileSync('.env', '.env.local');
  writeFileSync('.env', source);
}
console.log(JSON.stringify({ port, urls }));
