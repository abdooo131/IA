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

  // A refused renewal on the public home page shows the website rather than the sign in page.
  // Only when the API answered: it clears the cookies then, so the home page cannot loop back here.
  const toSite = upstream !== null && !upstream.ok && next === '/';
  // Resolved against a placeholder only to build the path and query: behind Render request.url
  // carries the internal address (0.0.0.0:10000), so the answer uses a relative Location.
  const target = new URL(upstream?.ok || toSite ? next : '/login', 'http://placeholder');
  if (!upstream?.ok && !toSite && next !== '/login') target.searchParams.set('next', next);
  // The API could not be reached, so the cookies stay: tell the sign in page not to send the
  // visitor straight back here.
  if (!upstream && refreshToken) target.searchParams.set('renew', 'failed');

  const response = new NextResponse(null, {
    status: 307,
    headers: { location: `${target.pathname}${target.search}` },
  });
  // Pass the new (or cleared) cookies from the API through to the browser.
  for (const cookie of upstream?.headers.getSetCookie() ?? []) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}
