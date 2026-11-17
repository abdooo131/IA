import { type AccessTokenClaims, isRole } from '@shiplynow/shared';
import { jwtVerify } from 'jose';

let cachedKey: Uint8Array | undefined;

function key(): Uint8Array {
  if (!cachedKey) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set for the web app');
    cachedKey = new TextEncoder().encode(secret);
  }
  return cachedKey;
}

/**
 * Verifies the access token locally. Used only to route the user to the right area;
 * the API verifies the token again on every call.
 */
export async function readClaims(token: string | undefined): Promise<AccessTokenClaims | null> {
  if (!token) return null;
  // Outside the try on purpose: a missing secret is a config error and must not look
  // like a signed out user.
  const secret = key();
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || !isRole(payload.role)) return null;
    return { sub: payload.sub, email: String(payload.email ?? ''), role: payload.role };
  } catch {
    return null;
  }
}
