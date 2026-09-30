import { InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { random, digest, equal, expiringMap, page, cookie, setCookie } from './security.js';
export const MCP_SCOPE = 'site:manage';
export class OwnerOAuthProvider {
  constructor(cfg) {
    this.cfg = cfg; this.resource = cfg.base + '/mcp';
    this.pending = expiringMap(); this.codes = expiringMap(); this.access = expiringMap(); this.refresh = expiringMap();
    this.clientsStore = { getClient: async id => id === 'cosa-desktop' ? {
      client_id: 'cosa-desktop', client_name: 'COSA Desktop',
      redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: MCP_SCOPE
    } : id === cfg.mcpClientId ? {
      client_id: cfg.mcpClientId, client_secret: cfg.mcpClientSecret, redirect_uris: cfg.redirects,
      client_name: 'COSA ChatGPT', token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: MCP_SCOPE
    } : undefined };
  }
  checkResource(resource) { if (resource && resource.href !== this.resource) throw new InvalidTargetError('Unexpected MCP resource'); }
  checkScopes(scopes) { if (scopes?.some(s => s !== MCP_SCOPE)) throw new InvalidScopeError('Only site:manage is available'); }
  async authorize(client, params, res) {
    this.checkResource(params.resource); this.checkScopes(params.scopes);
    const transaction = random(), browser = random();
    this.pending.set(transaction, { clientId: client.client_id, ...params, browser: digest(browser) }, 600000);
    setCookie(res, 'cosa_consent', browser, this.cfg.base.startsWith('https:'));
    res.type('html').send(page(`<p>ChatGPT에 COSA 사이트 정보 조회 및 스크립트 등록·수정 권한을 부여합니다.</p><p>로컬 .env의 ADMIN_PASSWORD를 입력하세요. 아임웹 비밀번호가 아닙니다.</p><form method="post" action="/consent"><input type="hidden" name="transaction" value="${transaction}"><label>소유자 승인 비밀번호 <input type="password" name="password" autocomplete="current-password" required></label><button>조회·수정 연결 승인</button></form>`));
  }
  consent(req, res) {
    const id = req.body.transaction, p = this.pending.get(id);
    if (!p || !equal(p.browser, digest(cookie(req, 'cosa_consent') || '')) || !equal(req.body.password, this.cfg.adminPassword)) return res.status(403).send('Approval failed. Restart the connection.');
    this.pending.delete(id);
    const code = random(); this.codes.set(digest(code), p, 60000);
    const target = new URL(p.redirectUri); target.searchParams.set('code', code);
    if (p.state !== undefined) target.searchParams.set('state', p.state);
    res.redirect(303, target.href);
  }
  code(client, code) { const item = this.codes.get(digest(code)); if (!item || item.clientId !== client.client_id) throw new InvalidGrantError('Expired or invalid authorization code'); return item; }
  async challengeForAuthorizationCode(client, code) { return this.code(client, code).codeChallenge; }
  issue(clientId) {
    const access = random(), refresh = random(), expires = Math.floor(Date.now() / 1000) + 3600;
    this.access.set(digest(access), { clientId, scopes: [MCP_SCOPE], expiresAt: expires, resource: new URL(this.resource) }, 3600000);
    this.refresh.set(digest(refresh), { clientId }, 86400000);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: MCP_SCOPE };
  }
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    this.checkResource(resource); const item = this.code(client, code);
    if (redirectUri !== item.redirectUri) throw new InvalidGrantError('Redirect URI mismatch');
    this.codes.delete(digest(code)); return this.issue(client.client_id);
  }
  async exchangeRefreshToken(client, token, scopes, resource) {
    this.checkResource(resource); this.checkScopes(scopes);
    const item = this.refresh.get(digest(token));
    if (!item || item.clientId !== client.client_id) throw new InvalidGrantError('Reconnect ChatGPT');
    this.refresh.delete(digest(token)); return this.issue(client.client_id);
  }
  async verifyAccessToken(token) {
    const item = this.access.get(digest(token));
    if (!item) throw new InvalidTokenError('Reconnect ChatGPT');
    return { token, ...item };
  }
  async revokeToken(client, request) {
    const key = digest(request.token);
    for (const map of [this.access, this.refresh]) if (map.get(key)?.clientId === client.client_id) map.delete(key);
  }
}
