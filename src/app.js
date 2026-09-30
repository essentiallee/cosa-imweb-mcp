import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OwnerOAuthProvider, MCP_SCOPE } from './mcp-auth.js';
import { createMcp } from './mcp.js';
import { random, digest, equal, expiringMap, cookie, setCookie, page } from './security.js';
export function createApp(cfg, imweb) {
  const app = express(), secure = cfg.base.startsWith('https:'), origin = new URL(cfg.base);
  const sessions = expiringMap(), states = expiringMap(), auth = new OwnerOAuthProvider(cfg);
  app.disable('x-powered-by'); app.set('trust proxy', cfg.proxy);
  app.use(helmet({ referrerPolicy: { policy: 'same-origin' }, contentSecurityPolicy: { directives: { 'form-action': ["'self'", 'https://openapi.imweb.me', 'http://127.0.0.1:*', 'http://localhost:*', ...cfg.redirects], 'upgrade-insecure-requests': secure ? [] : null } }, strictTransportSecurity: secure ? undefined : false }));
  app.use((req,res,next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.host !== origin.host || (req.headers.origin && req.headers.origin !== origin.origin)) return res.status(403).send('Origin or host not allowed');
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.use(express.json({ limit: '64kb' }));
  const loginLimit = rateLimit({ windowMs: 900000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.get('/health', (_req,res) => res.json({ status: 'ok' }));
  app.get('/', (_req,res) => res.type('html').send(page('<p>COSA 사이트 조회·스크립트 편집 MCP 서버입니다.</p><a href="/oauth/start">아임웹 연결 및 조회 확인</a>')));
  app.get('/oauth/start', (req,res) => {
    if (!cfg.siteCode) return res.status(503).type('html').send(page('<p>HTTPS 주소 준비가 완료되었습니다. 아임웹에서 이 주소를 등록하고 앱 테스트를 연결한 다음, 로컬 .env의 IMWEB_SITE_CODE를 입력하고 서버를 다시 시작하세요.</p>'));
    const nonce = random(); setCookie(res, 'cosa_setup', nonce, secure);
    res.type('html').send(page(`<p>.env의 ADMIN_PASSWORD를 입력하여 아임웹 연결을 시작하세요.</p><form method="post" action="/oauth/start"><input type="hidden" name="nonce" value="${nonce}"><input type="password" name="password" autocomplete="current-password" required><button>아임웹 조회·수정 권한 연결</button></form>`));
  });
  app.post('/oauth/start', loginLimit, (req,res) => {
    if (!cfg.siteCode) return res.status(503).send('Set IMWEB_SITE_CODE locally and restart the server.');
    if (!equal(req.body.nonce, cookie(req,'cosa_setup')) || !equal(req.body.password, cfg.adminPassword)) return res.status(403).send('Setup authorization failed');
    const state = random(), browser = random(); states.set(digest(state), digest(browser), 600000);
    setCookie(res, 'cosa_oauth', browser, secure);
    const session = random(); sessions.set(digest(session), true, 3600000); setCookie(res, 'cosa_admin', session, secure, 3600000);
    res.redirect(303, imweb.authorizationUrl(state));
  });
  app.get('/oauth/callback', async (req,res) => {
    // Upstream errors may omit state. Display a fixed diagnostic only; never
    // exchange a code, mutate sessions, or trust upstream message HTML here.
    if (req.query.errorCode !== undefined) {
      const message = req.query.errorCode === '30156'
        ? '아임웹이 site-info:write 권한을 필수로 요구하여 인증을 거절했습니다(30156). 앱의 사이트 정보 및 스크립트 읽기·쓰기 권한 설정을 확인하세요.'
        : '아임웹에서 인증 거절 응답을 받았습니다. 앱 설정과 허용 권한을 확인하세요.';
      return res.status(400).type('html').send(page('<p>' + message + '</p><p>토큰 발급이나 사이트 변경은 수행하지 않았습니다.</p>'));
    }
    if (typeof req.query.state !== 'string' || !equal(states.get(digest(req.query.state)), digest(cookie(req,'cosa_oauth') || ''))) return res.status(400).send('Invalid or expired OAuth state. Restart /oauth/start.');
    states.delete(digest(req.query.state));
    if (req.query.errorCode || typeof req.query.code !== 'string' || !req.query.code) return res.status(400).send('Imweb approval failed. Restart /oauth/start.');
    await imweb.exchange(req.query.code);
    res.redirect(303, '/connected');
  });
  const admin = (req,res,next) => sessions.get(digest(cookie(req,'cosa_admin') || '')) ? next() : res.status(401).send('Open /oauth/start to sign in.');
  app.get('/connected', admin, (_req,res) => res.type('html').send(page('<p>아임웹 토큰을 암호화하여 저장했습니다.</p><a href="/api/site-info">사이트 정보 READ 테스트</a>')));
  app.get('/api/site-info', admin, async (_req,res) => res.json(await imweb.getSiteInfo()));
  app.post('/consent', loginLimit, (req,res) => auth.consent(req,res));
  app.use(mcpAuthRouter({ provider: auth, issuerUrl: new URL(cfg.base), resourceServerUrl: new URL(cfg.base + '/mcp'), scopesSupported: [MCP_SCOPE], resourceName: 'COSA MCP' }));
  const protect = requireBearerAuth({ verifier: auth, requiredScopes: [MCP_SCOPE], resourceMetadataUrl: cfg.base + '/.well-known/oauth-protected-resource/mcp' });
  app.post('/mcp', protect, rateLimit({ windowMs: 60000, limit: 60 }), async (req,res) => {
    const server = createMcp(imweb), transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close().catch(() => {}); });
    await server.connect(transport); await transport.handleRequest(req,res,req.body);
  });
  app.all('/mcp', protect, (_req,res) => res.status(405).set('Allow','POST').end());
  app.use((error,_req,res,_next) => { if (!res.headersSent) res.status(500).json({ error: 'Request failed. Check local configuration, Imweb connection and read permission; then retry.' }); });
  return { app, auth };
}
