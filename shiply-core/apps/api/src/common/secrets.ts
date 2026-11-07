// Encrypts secrets we must keep and use later, such as a store's access token. The key comes from
// SECRETS_KEY (or, failing that, the session signing secret), so a copy of the database alone
// does not reveal them.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function key() {
  const base = process.env.SECRETS_KEY || process.env.JWT_SECRET;
  if (!base) throw new Error('SECRETS_KEY or JWT_SECRET must be set');
  return createHash('sha256').update(`shiply-secrets:${base}`).digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function unseal(sealed: string) {
  const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data) throw new Error('Not a sealed value');
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
