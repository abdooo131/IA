'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useMe } from '@/shell/me';

export interface Answer {
  ok: boolean;
  colour: 'green' | 'amber' | 'red';
  big: string;
  small?: string;
  reason?: string;
}

interface Pending {
  url: string;
  /** who scanned it: another login on the same phone never sends it */
  userId: string;
  body: Record<string, unknown> & { deviceScanId: string; clientAt: string; code?: string };
}

export interface Refused {
  code: string;
  reason: string;
}

const KEY = 'shiply.scans';

function read(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}
function write(list: Pending[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: scans are still sent while online */
  }
}

let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const refused: Refused[] = [];

/** 'retry' keeps the scan: no signal, or the server could not answer (5xx). A 4xx is an answer. */
async function send(p: Pending): Promise<Answer | 'retry'> {
  try {
    return await api<Answer>(p.url, { method: 'POST', json: p.body });
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) return { ok: false, colour: 'red', big: '!', reason: err.body.error ?? 'refused' };
    return 'retry';
  }
}

/**
 * Scans are kept on the phone and sent in order, for this user only. When the signal drops they
 * wait and go when it is back; the server answers a resent scan with its first answer. What the
 * server refuses after a wait is kept on screen, so nobody misses it.
 */
export function flushQueue(userId: string, waitingFor?: string): Promise<void> {
  flushing ??= (async () => {
    for (;;) {
      const first = read().find((x) => x.userId === userId);
      if (!first || !navigator.onLine) break;
      const a = await send(first);
      if (a === 'retry') break;
      write(read().filter((x) => x.body.deviceScanId !== first.body.deviceScanId));
      if (!a.ok && first.body.deviceScanId !== waitingFor) refused.unshift({ code: String(first.body.code ?? first.url.split('/').at(-2) ?? ''), reason: a.reason ?? 'refused' });
      changed();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function useScanQueue() {
  const me = useMe();
  const [pending, setPending] = useState(0);
  const [late, setLate] = useState<Refused[]>([]);
  useEffect(() => {
    const update = () => {
      setPending(read().filter((x) => x.userId === me.id).length);
      setLate([...refused]);
    };
    update();
    listeners.add(update);
    const online = () => void flushQueue(me.id);
    window.addEventListener('online', online);
    void flushQueue(me.id);
    return () => {
      listeners.delete(update);
      window.removeEventListener('online', online);
    };
  }, [me.id]);

  /** Queues one scan and sends what can be sent; the answer comes back when it was sent now. */
  const submit = useCallback(
    async (url: string, body: Record<string, unknown>): Promise<Answer | null> => {
      const p: Pending = { url, userId: me.id, body: { ...body, deviceScanId: crypto.randomUUID(), clientAt: new Date().toISOString() } };
      write([...read(), p]);
      changed();
      await flushQueue(me.id, p.body.deviceScanId);
      if (read().some((x) => x.body.deviceScanId === p.body.deviceScanId)) return null;
      // sent: ask again for its stored answer (the server returns the first one)
      const a = await send(p);
      return a === 'retry' ? null : a;
    },
    [me.id],
  );

  return { pending, refused: late, submit };
}
