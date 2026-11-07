import { z } from 'zod';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Shopify webhooks and fulfillment service callbacks: base64 HMAC SHA256 of the raw body. */
export function verifyBodyHmac(raw: Buffer, header: string | undefined, secret: string) {
  // Without the app secret nothing can be verified, so nothing is accepted.
  if (!header || !secret) return false;
  const digest = createHmac('sha256', secret).update(raw).digest('base64');
  return sameText(digest, header);
}

/**
 * OAuth redirects and app proxy style requests: hex HMAC of the other query parameters,
 * sorted by name and joined as name=value with &.
 */
export function verifyQueryHmac(query: Record<string, unknown>, secret: string) {
  const { hmac, signature: _signature, ...rest } = query;
  if (typeof hmac !== 'string' || !secret) return false;
  const message = Object.keys(rest)
    .sort()
    .map(
      (k) => `${k}=${Array.isArray(rest[k]) ? (rest[k] as string[]).join(',') : String(rest[k])}`,
    )
    .join('&');
  const digest = createHmac('sha256', secret).update(message).digest('hex');
  return sameText(digest, hmac);
}

/**
 * App proxy requests (the storefront calling us through the shop's own domain): hex HMAC of
 * the other query parameters as name=value, sorted, joined with nothing in between.
 */
export function verifyProxySignature(query: Record<string, unknown>, secret: string) {
  const { signature, ...rest } = query;
  if (typeof signature !== 'string' || !secret) return false;
  const message = Object.keys(rest)
    .map(
      (k) => `${k}=${Array.isArray(rest[k]) ? (rest[k] as string[]).join(',') : String(rest[k])}`,
    )
    .sort()
    .join('');
  const digest = createHmac('sha256', secret).update(message).digest('hex');
  return sameText(digest, signature);
}

/** A myshopify.com domain, the only kind of shop address we accept. */
export function isShopDomain(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
}

/** "evechantelle" or "evechantelle.myshopify.com", stored as the full myshopify.com address. */
export const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v.endsWith('.myshopify.com') ? v : `${v}.myshopify.com`))
  .refine(isShopDomain, 'invalid_shop');

function keyFrom(secret: string) {
  return Buffer.from(hkdfSync('sha256', secret, 'shiply-now', 'shopify-access-token', 32));
}

/** Encrypts a shop's access token at rest (AES 256 GCM, key derived from the app secret). */
export function sealToken(token: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}

export function openToken(sealed: string, secret: string) {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unknown token format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
