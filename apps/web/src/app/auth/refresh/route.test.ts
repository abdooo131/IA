import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => vi.unstubAllGlobals());

// Behind Render the request arrives on the internal address; the redirect must never name it.
const internal = (path: string, cookie?: string) =>
  new NextRequest(`http://0.0.0.0:10000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });

describe('GET /auth/refresh', () => {
  it('answers a relative address back to where the person was going', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200, headers: { 'set-cookie': 'a=1' } })),
    );
    const res = await GET(internal('/auth/refresh?next=/admin/orders', 'shiply_rt=x'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/admin/orders');
  });

  it('keeps a refused renewal on our own site', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const res = await GET(internal('/auth/refresh?next=/%09/evil.com', 'shiply_rt=x'));
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('/')).toBe(true);
    expect(location.startsWith('//')).toBe(false);
    expect(location).not.toContain('0.0.0.0');
    expect(location).not.toContain('evil.com');
  });
});
