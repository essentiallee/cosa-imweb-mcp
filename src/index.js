import { config } from './config.js';
import { TokenStore } from './token-store.js';
import { ImwebClient } from './imweb.js';
import { createApp } from './app.js';
try {
  const cfg = config();
  const store = new TokenStore(cfg.tokenFile, cfg.encryptionKey, cfg.clientId + ':' + cfg.siteCode);
  await store.load();
  const { app } = createApp(cfg, new ImwebClient(cfg, store));
  const server = app.listen(cfg.port, cfg.host, () => console.log(`COSA MCP ready: ${cfg.base}/oauth/start`));
  server.on('error', () => { console.error('Server could not start. Check port and host configuration.'); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
} catch (e) { console.error(e.message); process.exitCode = 1; }
