import { REFRESH_TOKEN_COOKIE } from '@shiplynow/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { safeNext } from '@/lib/access';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Called by the middleware when the access token has expired but a refresh token exists.
 * Rotates the tokens through the API, then sends the user back where they were going.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get('next')) ?? '/';
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  let upstream: Response | null = null;
  if (refreshToken) {
    upstream = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
      cache: 'no-store',
    }).catch(() => null);
  }

  const target = new URL(upstream?.ok ? next : '/login', request.url);
  if (!upstream?.ok) target.searchParams.set('next', next);

  const response = NextResponse.redirect(target);
  // Pass the new (or cleared) cookies from the API through to the browser.
  for (const cookie of upstream?.headers.getSetCookie() ?? []) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}
