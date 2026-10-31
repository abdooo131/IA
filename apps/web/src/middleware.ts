import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@shiplynow/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { decideAccess } from '@/lib/access';
import { readClaims } from '@/lib/session';

export async function middleware(request: NextRequest) {
  const claims = await readClaims(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
  const decision = decideAccess({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    role: claims?.role ?? null,
    hasRefreshToken: request.cookies.has(REFRESH_TOKEN_COOKIE),
  });

  switch (decision.kind) {
    case 'allow':
      return NextResponse.next();
    case 'login':
    case 'refresh': {
      const url = new URL(decision.kind === 'login' ? '/login' : '/auth/refresh', request.url);
      url.searchParams.set('next', decision.next);
      return NextResponse.redirect(url);
    }
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, request.url));
  }
}

export const config = {
  // Node.js runtime so the middleware reads JWT_ACCESS_SECRET at runtime, without it
  // ever being inlined into a bundle.
  runtime: 'nodejs',
  matcher: [
    '/admin/:path*',
    '/store/:path*',
    '/rider/:path*',
    '/merchant/:path*',
    '/finance/:path*',
  ],
};
