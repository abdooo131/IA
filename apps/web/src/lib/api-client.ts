/**
 * The access cookie lasts 15 minutes; a screen that stays open longer (polling queues, the
 * rider app, long forms) gets 401 from the API. One renewal is shared by every call that
 * hits 401 at the same moment, because the API rotates the refresh token on use and a
 * second renewal with the old token would be refused.
 */
let renewal: Promise<'renewed' | 'refused' | 'network'> | null = null;
let sentToLogin = false;

/** Renews the session through the /api proxy (the API sets the new cookies). */
export function renewSession(): Promise<'renewed' | 'refused' | 'network'> {
  renewal ??= fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' })
    .then((res) => (res.ok ? ('renewed' as const) : ('refused' as const)))
    .catch(() => 'network' as const)
    .finally(() => {
      renewal = null;
    });
  return renewal;
}

/** Sends the person to sign in, coming back to the page they were on. Only once. */
function toLogin() {
  if (sentToLogin || typeof window === 'undefined') return;
  sentToLogin = true;
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}

/**
 * fetch for /api paths that renews an expired session once and repeats the call once.
 * When the renewal is refused the person is sent to sign in. The body must be one that can
 * be sent twice (a string, FormData, a Blob or bytes; never a stream).
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, init);
  if (res.status !== 401 || path.startsWith('/auth/')) return res;
  const renewed = await renewSession();
  if (renewed === 'renewed') return fetch(`/api${path}`, init);
  if (renewed === 'refused') toLogin();
  return res;
}

/** Calls the API from the browser through the /api proxy, so the session cookie is sent. */
export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<
  { ok: true; data: T } | { ok: false; error: string; details?: Record<string, unknown> }
> {
  try {
    const res = await apiFetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    // A refusal may carry plain values next to its code (amounts, a distance).
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}`, details: data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** GET from the browser through the /api proxy. */
export async function apiGetClient<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(path, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** For tests: forget that the person was sent to sign in. */
export function resetApiClientForTests() {
  renewal = null;
  sentToLogin = false;
}
