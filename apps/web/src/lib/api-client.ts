/** Calls the API from the browser through the /api proxy, so the session cookie is sent. */
export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'network' };
  }
}
