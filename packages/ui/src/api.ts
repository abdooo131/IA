'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export type AppName = 'merchant' | 'ops';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string; role: string; language: 'en' | 'ar'; merchantId: string | null };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

const key = (app: AppName) => `shiply.session.${app}`;

export function loadSession(app: AppName): Session | null {
  try {
    const raw = localStorage.getItem(key(app));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(app: AppName, s: Session | null) {
  try {
    if (s) localStorage.setItem(key(app), JSON.stringify(s));
    else localStorage.removeItem(key(app));
  } catch {
    /* storage unavailable */
  }
}

/** Fetch wrapper: adds the bearer token and transparently refreshes once on 401. */
export function createClient(app: AppName, onLogout: () => void) {
  let refreshing: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    const s = loadSession(app);
    if (!s) return false;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    saveSession(app, { ...s, ...body });
    return true;
  }

  async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const s = loadSession(app);
    const headers = new Headers(init.headers);
    if (s) headers.set('Authorization', `Bearer ${s.accessToken}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (res.status === 401 && retry && s) {
      refreshing ??= refresh().finally(() => (refreshing = null));
      if (await refreshing) return raw(path, init, false);
      saveSession(app, null);
      onLogout();
    }
    return res;
  }

  async function json<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await raw(path, init);
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message ?? res.statusText;
      throw new ApiError(res.status, msg, body);
    }
    return body as T;
  }

  /** Fetches a binary response (PDF, Excel) as a Blob. */
  async function blob(path: string, init: RequestInit = {}): Promise<Blob> {
    const res = await raw(path, init);
    if (!res.ok) {
      let msg = 'Download failed';
      try {
        msg = (await res.json())?.message ?? msg;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, msg, null);
    }
    return res.blob();
  }

  /** Opens a PDF (or other binary) response in a new tab without exposing the token in a URL. */
  async function openBlob(path: string, init: RequestInit = {}) {
    const win = window.open('', '_blank');
    const res = await raw(path, init);
    if (!res.ok) {
      win?.close();
      throw new ApiError(res.status, 'Download failed', null);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.href = url;
  }

  async function download(path: string, filename: string) {
    const res = await raw(path);
    if (!res.ok) throw new ApiError(res.status, 'Download failed', null);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    raw,
    json,
    get: <T = any>(p: string) => json<T>(p),
    post: <T = any>(p: string, body?: unknown) =>
      json<T>(p, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
    patch: <T = any>(p: string, body?: unknown) => json<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
    put: <T = any>(p: string, body?: unknown) => json<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    openBlob,
    blob,
    download,
  };
}

export type ApiClient = ReturnType<typeof createClient>;
