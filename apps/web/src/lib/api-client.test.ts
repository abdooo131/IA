import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGetClient, apiSend, resetApiClientForTests } from './api-client';

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client session renewal', () => {
  const assign = vi.fn();

  beforeEach(() => {
    resetApiClientForTests();
    assign.mockReset();
    vi.stubGlobal('window', { location: { pathname: '/rider', search: '?a=1', assign } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renews once on 401 and repeats the call', async () => {
    let expired = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        expired = false;
        return json(200);
      }
      return expired ? json(401, { error: 'unauthorized' }) : json(200, { n: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await apiGetClient('/rider/orders')).toEqual({ ok: true, data: { n: 1 } });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/rider/orders',
      '/api/auth/refresh',
      '/api/rider/orders',
    ]);
    expect(assign).not.toHaveBeenCalled();
  });

  it('shares one renewal between calls that fail together', async () => {
    let expired = true;
    let refreshes = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') {
          refreshes++;
          await gate;
          expired = false;
          return json(200);
        }
        return expired ? json(401) : json(200, {});
      }),
    );

    const calls = [apiGetClient('/a'), apiSend('POST', '/b', { x: 1 }), apiGetClient('/c')];
    await new Promise((r) => setTimeout(r, 0));
    release();
    const results = await Promise.all(calls);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshes).toBe(1);
  });

  it('sends the person to sign in when the renewal is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url === '/api/auth/refresh' ? json(401) : json(401))),
    );
    expect(await apiSend('POST', '/x')).toMatchObject({ ok: false, error: 'http_401' });
    expect(assign).toHaveBeenCalledWith('/login?next=%2Frider%3Fa%3D1');
  });

  it('stays on the page when the renewal could not reach the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') throw new TypeError('offline');
        return json(401);
      }),
    );
    expect((await apiGetClient('/x')).ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('never renews for the auth routes themselves', async () => {
    const fetchMock = vi.fn(async () => json(401));
    vi.stubGlobal('fetch', fetchMock);
    await apiSend('POST', '/auth/logout');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
