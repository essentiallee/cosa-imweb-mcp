export const IMWEB_BASE = 'https://openapi.imweb.me';
export const IMWEB_SCOPE = 'site-info:read';
export class ImwebError extends Error {
  constructor(status, code) { super(`Imweb request failed (HTTP ${status}, code ${/^\d+$/.test(String(code)) ? code : 'unknown'}). Check app connection and permissions.`); this.status = status; this.code = Number(code); }
}
export class ImwebClient {
  constructor(cfg, store, fetcher = fetch) { this.cfg = cfg; this.store = store; this.fetch = fetcher; this.queue = Promise.resolve(); }
  // Serialize token exchange/rotation and reads: one process, one site, no refresh races.
  exclusive(fn) { const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }
  authorizationUrl(state) {
    const url = new URL('/oauth2/authorize', IMWEB_BASE);
    url.search = new URLSearchParams({ responseType: 'code', clientId: this.cfg.clientId, redirectUri: this.cfg.base + '/oauth/callback', scope: IMWEB_SCOPE, state, siteCode: this.cfg.siteCode });
    return url.href;
  }
  async request(path, init) {
    let res, payload;
    try { res = await this.fetch(IMWEB_BASE + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); } catch { throw Error('Imweb network request failed; retry later'); }
    try { payload = await res.json(); } catch { throw Error('Imweb returned an invalid response'); }
    if (!res.ok || payload.errorCode || (payload.statusCode && payload.statusCode !== 200)) throw new ImwebError(res.status, payload.errorCode);
    if (!payload.data || typeof payload.data !== 'object') throw Error('Imweb response is missing data');
    return payload.data;
  }
  async token(fields) {
    const data = await this.request('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(this.cfg.clientId + ':' + this.cfg.clientSecret).toString('base64') }, body: new URLSearchParams({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret, ...fields }) });
    const scopes = Array.isArray(data.scope) ? data.scope : typeof data.scope === 'string' ? data.scope.split(/\s+/) : [];
    if (!data.accessToken || !data.refreshToken || !scopes.includes(IMWEB_SCOPE) || scopes.some(s => s !== IMWEB_SCOPE)) throw Error('Token response missing credentials or has unexpected scopes; authorize site-info:read only');
    const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken, scope: scopes, expiresAt: Date.now() + 7200000, refreshExpiresAt: Date.now() + 90 * 86400000 };
    await this.store.save(tokens); return tokens;
  }
  exchange(code) { return this.exclusive(() => this.token({ grantType: 'authorization_code', code, redirectUri: this.cfg.base + '/oauth/callback' })); }
  async refresh(tokens) {
    if (tokens.refreshExpiresAt <= Date.now()) throw Error('Imweb authorization expired. Open /oauth/start again.');
    return this.token({ grantType: 'refresh_token', refreshToken: tokens.refreshToken });
  }
  getSiteInfo() { return this.exclusive(async () => {
    let tokens = await this.store.load();
    if (!tokens) throw Error('Connect Imweb first at /oauth/start.');
    if (tokens.expiresAt <= Date.now() + 60000) tokens = await this.refresh(tokens);
    const read = () => this.request('/site-info', { method: 'GET', headers: { Authorization: 'Bearer ' + tokens.accessToken } });
    let site;
    try { site = await read(); } catch (e) {
      if (!(e instanceof ImwebError) || e.status !== 401 || ![30101,30102].includes(e.code)) throw e;
      tokens = await this.refresh(tokens); site = await read();
    }
    if (site.siteCode !== this.cfg.siteCode) throw Error('Site identity mismatch; reconnect the configured COSA site.');
    // Only expose basic information. Owner identifiers and arbitrary app config stay server-side.
    return { siteCode: site.siteCode, unitList: Array.isArray(site.unitList) ? site.unitList.filter(u => u && typeof u === 'object').map(({ unitCode, name, currency }) => ({ unitCode, name, currency })) : [] };
  }); }
}
