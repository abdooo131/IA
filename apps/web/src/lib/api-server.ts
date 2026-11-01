import 'server-only';
import { ACCESS_TOKEN_COOKIE } from '@shiplynow/shared';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

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
