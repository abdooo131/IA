import 'server-only';
import { ACCESS_TOKEN_COOKIE, type PublicUser } from '@shiplynow/shared';
import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme, toTheme } from './preferences';
import { readClaims } from './session';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

export async function getClaims() {
  return readClaims((await cookies()).get(ACCESS_TOKEN_COOKIE)?.value);
}

/** Loads the signed in user from the API, or null when the session is not valid. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${apiUrl}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { user: PublicUser };
  return body.user;
}

export async function getTheme(): Promise<Theme> {
  return toTheme((await cookies()).get(THEME_COOKIE)?.value);
}
