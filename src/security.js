import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
export const random = () => randomBytes(32).toString('base64url');
export const digest = s => createHash('sha256').update(s).digest('hex');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
export function setCookie(res, name, value, secure, maxAge = 600000) { res.cookie(name, value, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' }); }
export function expiringMap(limit = 1000) {
  const map = new Map();
  return {
    set(key, value, ttl) { for (const [k,v] of map) if (v.expires <= Date.now()) map.delete(k); if (map.size >= limit) throw Error('Temporary capacity exceeded'); map.set(key, { value, expires: Date.now() + ttl }); },
    get(key) { const item = map.get(key); if (!item || item.expires <= Date.now()) { map.delete(key); return undefined; } return item.value; },
    delete(key) { map.delete(key); }
  };
}
export const page = body => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>COSA MCP</title><body><main><h1>COSA MCP</h1>${body}</main></body></html>`;
