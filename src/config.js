import path from 'node:path';
export function config(env = process.env) {
  const base = new URL(env.PUBLIC_BASE_URL || 'http://localhost:3000');
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw Error('PUBLIC_BASE_URL must be an origin');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw Error('HTTPS required outside localhost');
  for (const key of ['IMWEB_CLIENT_ID', 'IMWEB_CLIENT_SECRET', 'ADMIN_PASSWORD', 'TOKEN_ENCRYPTION_KEY', 'MCP_CLIENT_SECRET']) {
    if (!env[key]) throw Error(`Missing ${key}. Run npm run setup and edit .env locally.`);
  }
  if (!/^[a-f\d]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)) throw Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters');
  if (env.ADMIN_PASSWORD.length < 32 || env.MCP_CLIENT_SECRET.length < 32) throw Error('Use generated secrets of at least 32 characters');
  const redirects = (env.MCP_REDIRECT_URIS || '').split(',').filter(Boolean).map(s => s.trim());
  for (const uri of redirects) {
    const u = new URL(uri);
    if (u.hash || u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) throw Error('Invalid MCP redirect URI');
  }
  const port = Number(env.PORT || 3000), proxy = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(proxy) || proxy < 0 || proxy > 2) throw Error('Invalid port/proxy configuration');
  return { base: base.origin, port, host: env.HOST || '127.0.0.1', proxy, clientId: env.IMWEB_CLIENT_ID, clientSecret: env.IMWEB_CLIENT_SECRET,
    siteCode: env.IMWEB_SITE_CODE || '', adminPassword: env.ADMIN_PASSWORD, encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    tokenFile: path.resolve(env.TOKEN_FILE || '.data/imweb-tokens.enc'), mcpClientId: env.MCP_CLIENT_ID || 'cosa-chatgpt', mcpClientSecret: env.MCP_CLIENT_SECRET, redirects };
}
