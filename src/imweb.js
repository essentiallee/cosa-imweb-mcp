import { digest, random } from './security.js';
import { TokenStore } from './token-store.js';
import path from 'node:path';
export const IMWEB_BASE = 'https://openapi.imweb.me';
export const IMWEB_SCOPE = 'site-info:write script:write';
const ALLOWED_SCOPES = new Set(['site-info:read','site-info:write','script:read','script:write']);
export class ImwebError extends Error {
  constructor(status, code) { super(`Imweb request failed (HTTP ${status}, code ${/^\d+$/.test(String(code)) ? code : 'unknown'}). Check app connection and permissions.`); this.status = status; this.code = Number(code);
    const hints = { 30173: ' Imweb rejected the script format. Check allowed HTML/script tags.', 30174: ' A script already exists at this position. Read it before updating.', 30175: ' No script exists at this position. Read it before creating.', 30103: ' The token lacks the required scope. Reauthorize the app.' };
    this.message += hints[this.code] || '';  }
}
export class ImwebClient {
  constructor(cfg, store, fetcher = fetch) { this.cfg = cfg; this.store = store; this.fetch = fetcher; this.queue = Promise.resolve(); }
  // Serialize token exchange/rotation and reads: one process, one site, no refresh races.
  exclusive(fn) { const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }
  authorizationUrl(state) {
    if (!this.cfg.siteCode) throw Error('Set IMWEB_SITE_CODE before starting authorization.');
    const url = new URL('/oauth2/authorize', IMWEB_BASE);
    url.search = new URLSearchParams({ responseType: 'code', clientId: this.cfg.clientId, redirectUri: this.cfg.base + '/oauth/callback', scope: IMWEB_SCOPE, state, siteCode: this.cfg.siteCode });
    return url.href;
  }
  async request(path, init) {
    let res, payload;
    try { res = await this.fetch(IMWEB_BASE + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); } catch { throw Error('Imweb network request failed; retry later'); }
    try { payload = await res.json(); } catch { throw Error('Imweb returned an invalid response'); }
    if (!res.ok || payload.errorCode || (payload.statusCode && payload.statusCode !== 200)) throw new ImwebError(res.status, payload.errorCode ?? payload.code ?? payload.error?.errorCode ?? payload.error?.code ?? payload.data?.errorCode ?? payload.data?.code);
    if (!Object.hasOwn(payload, 'data')) throw Error('Imweb response is missing data');
    return payload.data;
  }
  async token(fields) {
    const data = await this.request('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(this.cfg.clientId + ':' + this.cfg.clientSecret).toString('base64') }, body: new URLSearchParams({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret, ...fields }) });
    const scopes = Array.isArray(data.scope) ? data.scope : typeof data.scope === 'string' ? data.scope.split(/\s+/) : [];
    if (!data.accessToken || !data.refreshToken || !IMWEB_SCOPE.split(' ').every(s => scopes.includes(s)) || scopes.some(s => !ALLOWED_SCOPES.has(s))) throw Error('Token response missing credentials or has unexpected scopes; authorize site-info:write and script:write');
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, scope: scopes, expiresAt: Date.now() + 7200000, refreshExpiresAt: Date.now() + 90 * 86400000 };
    await this.store.save(tokens); return tokens;
  }
  exchange(code) { return this.exclusive(() => this.token({ grantType: 'authorization_code', code, redirectUri: this.cfg.base + '/oauth/callback' })); }
  async refresh(tokens) {
    if (tokens.refreshExpiresAt <= Date.now()) throw Error('Imweb authorization expired. Open /oauth/start again.');
    return this.token({ grantType: 'refresh_token', refreshToken: tokens.refreshToken });
  }
  async authenticated(pathname, init = { method: 'GET' }) {
    let tokens = await this.store.load();
    if (!tokens) throw Error('Connect Imweb first at /oauth/start.');
    if (tokens.expiresAt <= Date.now() + 60000) tokens = await this.refresh(tokens);
    const run = () => this.request(pathname, { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + tokens.accessToken } });
    try { return await run(); } catch (e) {
      // Never automatically retry mutations: a lost response may hide a successful write.
      if (init.method !== 'GET' || !(e instanceof ImwebError) || e.status !== 401 || ![30101,30102].includes(e.code)) throw e;
      tokens = await this.refresh(tokens); return run();
    }
  }
  async site() {
    const site = await this.authenticated('/site-info');
    if (site?.siteCode !== this.cfg.siteCode) throw Error('Site identity mismatch; reconnect the configured COSA site.');
    return { siteCode: site.siteCode, unitList: Array.isArray(site.unitList) ? site.unitList.filter(u => u && typeof u === 'object').map(({ unitCode, name, currency }) => ({ unitCode, name, currency })) : [] };
  }
  getSiteInfo() { return this.exclusive(() => this.site()); }
  async scripts(unitCode, position) {
    const site = await this.site();
    if (!site.unitList.some(u => u.unitCode === unitCode)) throw Error('Unit does not belong to the configured COSA site.');
    const data = await this.authenticated('/script?' + new URLSearchParams({ unitCode, position }));
    if (!Array.isArray(data) || data.some(s => s.siteCode !== this.cfg.siteCode || s.unitCode !== unitCode || s.position !== position || typeof s.scriptContent !== 'string')) throw Error('Unexpected script response; refusing to modify.');
    if (data.length > 1) throw Error('Ambiguous script position; refusing to modify.');
    const content = data[0]?.scriptContent ?? null;
    return { unitCode, position, exists: content !== null, scriptContent: content, revision: digest(JSON.stringify(content)) };
  }
  getScript(unitCode, position) { return this.exclusive(() => this.scripts(unitCode, position)); }
  saveScript({ unitCode, position, scriptContent, expectedRevision }, create = false) {
    return this.exclusive(async () => {
      const before = await this.scripts(unitCode, position);
      if (before.revision !== expectedRevision) throw Error('Script changed since last read. Read it again before editing.');
      if (create === before.exists) throw Error(create ? 'Script already exists; use update_script.' : 'No script exists; use create_script.');
      const backupId = random();
      const backup = new TokenStore(path.join(path.dirname(this.cfg.tokenFile), 'script-backups', backupId + '.enc'), this.cfg.encryptionKey, this.cfg.clientId + ':' + this.cfg.siteCode);
      await backup.save({ ...before, savedAt: new Date().toISOString() });
      const result = await this.authenticated('/script', { method: create ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitCode, position, scriptContent }) });
      if (result !== true) throw Error('Write was not confirmed. Read the script before retrying. Backup: ' + backupId);
      return { success: true, backupId, unitCode, position, message: 'Imweb accepted the change. Read the script and inspect the page to verify.' };
    });
  }
}
