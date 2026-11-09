'use client';
// Calls the API through the web app's /api proxy. On an expired session it refreshes once, and if
// that fails it sends the user to login and back to this page afterwards.

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; [k: string]: unknown },
  ) {
    super(body.error ?? `HTTP ${status}`);
  }
}

function toLogin() {
  const locale = window.location.pathname.split('/')[1] || 'en';
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/${locale}/login?next=${encodeURIComponent(next)}`);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; idempotent?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET' && init.idempotent !== false) headers.set('idempotency-key', crypto.randomUUID());
  const send = () =>
    fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  let res = await send();
  if (res.status === 401) {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (r.ok) res = await send();
    else {
      toLogin();
      return new Promise<T>(() => undefined);
    }
  }
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body ?? {});
  return body as T;
}
