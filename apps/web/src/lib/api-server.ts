import 'server-only';
import {
  ACCESS_TOKEN_COOKIE,
  type AccessProfile,
  type MerchantRightName,
  type MyAccess,
} from '@shiplynow/shared';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

/**
 * GET from the API on behalf of the signed in user. Sends them to login if the session ended,
 * and shows the "not found" page when the record does not exist or is not theirs to see (an
 * order of another store, an old link), instead of an error page.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  const res = await fetch(`${apiUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  if (res.status === 404 || res.status === 403) notFound();
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/**
 * GET for a secondary part of a page (notes, money, insight): null instead of the not found
 * page when the API refuses or fails, so the rest of the page still shows.
 */
export async function apiTry<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  const res = await fetch(`${apiUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

/**
 * What the signed in person may open (GET /me/access), read once per request however many
 * layouts and pages ask. Null when signed out or the API cannot answer.
 */
export const getMyAccess = cache(async (): Promise<MyAccess | null> => {
  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${apiUrl}/me/access`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as MyAccess;
});

/** A team member's access profile, or null for riders, merchants and signed out visitors. */
export async function getMyProfile(): Promise<AccessProfile | null> {
  const access = await getMyAccess();
  return access?.kind === 'team' ? access.profile : null;
}

/** The merchant user's rights (owners have all), or null when not a merchant user. */
export async function getMerchantRights(): Promise<{
  owner: boolean;
  rights: MerchantRightName[];
} | null> {
  const access = await getMyAccess();
  if (access?.kind !== 'merchant') return null;
  return { owner: access.merchantRole === 'owner', rights: access.rights };
}

/** A merchant page that needs a right shows not found to a member without it. */
export async function requireMerchantRight(right: MerchantRightName | 'owner') {
  const me = await getMerchantRights();
  if (!me) notFound();
  if (right === 'owner' ? !me.owner : !me.rights.includes(right)) notFound();
}
