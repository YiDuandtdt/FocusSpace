// Local production delivery deliberately ignores prior LAN/public bind settings.
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.LOCAL_PORT || '3002';
process.env.APP_ORIGINS =
  'http://127.0.0.1:' + process.env.PORT + ',http://localhost:' + process.env.PORT;
process.env.COOKIE_SECURE = 'false';
await import('./start.mjs');
