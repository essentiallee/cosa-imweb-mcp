import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export class TokenStore {
  constructor(file, key, binding) { this.file = file; this.key = Buffer.from(key, 'hex'); this.aad = Buffer.from(binding); }
  async load() {
    let data;
    try { data = JSON.parse(await readFile(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw Error('Token storage cannot be read'); }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data.iv, 'base64'));
      decipher.setAAD(this.aad); decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.body, 'base64')), decipher.final()]).toString());
    } catch { throw Error('Token storage cannot be decrypted; check key/site configuration'); }
  }
  async save(tokens) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(this.aad);
    const body = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = this.file + '.' + randomBytes(8).toString('hex') + '.tmp';
    await writeFile(tmp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }), { mode: 0o600, flag: 'wx' });
    await rename(tmp, this.file); await chmod(this.file, 0o600);
  }
}
