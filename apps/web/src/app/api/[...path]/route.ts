import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** Headers that belong to one connection and must not be copied across the proxy. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'host',
  'content-length',
];

/**
 * Forwards /api/* to the NestJS API so the browser only ever talks to this origin and
 * the auth cookies stay first party. The API address is read at runtime (API_URL), so
 * one build works on any host.
 */
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const target = new URL(`${base}/${path.map(encodeURIComponent).join('/')}`);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    init.body = await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json({ error: 'api_unreachable' }, { status: 502 });
  }

  const out = new Headers(upstream.headers);
  // fetch already decompressed the body, and Set-Cookie must stay one header per cookie.
  for (const name of [
    'content-encoding',
    'content-length',
    'transfer-encoding',
    'connection',
    'set-cookie',
  ]) {
    out.delete(name);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT };
