// Forwards /api/* to the API so the session cookie stays on the web origin.
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = process.env.API_URL ?? 'http://localhost:4100';
  const url = `${base}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  // The merchant API signs in with a key header instead of the cookie.
  for (const name of ['content-type', 'cookie', 'accept', 'authorization', 'x-api-key', 'idempotency-key']) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const res = await fetch(url, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: 'manual', cache: 'no-store' });
  const out = new Headers();
  const type = res.headers.get('content-type');
  if (type) out.set('content-type', type);
  for (const name of ['retry-after', 'x-ratelimit-remaining', 'idempotent-replayed', 'content-disposition', 'cache-control']) {
    const v = res.headers.get(name);
    if (v) out.set(name, v);
  }
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE, forward as PATCH };
