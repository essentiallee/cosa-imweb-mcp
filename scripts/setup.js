import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const values = { ADMIN_PASSWORD: randomBytes(32).toString('base64url'), TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'), MCP_CLIENT_SECRET: randomBytes(32).toString('base64url') };
const contents = template.replace(/^(ADMIN_PASSWORD|TOKEN_ENCRYPTION_KEY|MCP_CLIENT_SECRET)=$/gm, (_,key) => `${key}=${values[key]}`);
try { await writeFile(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 }); console.log('Created private .env. Open it locally and fill IMWEB_CLIENT_ID, IMWEB_CLIENT_SECRET, IMWEB_SITE_CODE. No secrets printed.'); }
catch (e) { if (e.code !== 'EEXIST') throw e; console.log('.env already exists; kept unchanged.'); }
