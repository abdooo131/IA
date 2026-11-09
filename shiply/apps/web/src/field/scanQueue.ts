'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export interface Answer {
  ok: boolean;
  colour: 'green' | 'amber' | 'red';
  big: string;
  small?: string;
  reason?: string;
}

interface Pending {
  url: string;
  body: Record<string, unknown> & { deviceScanId: string; clientAt: string };
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

/**
 * Scans are kept on the phone and sent in order. When the signal drops they wait and go when it is
 * back; the server answers a resent scan (same deviceScanId) with its first answer.
 */
async function send(p: Pending): Promise<Answer | 'offline'> {
  try {
    return await api<Answer>(p.url, { method: 'POST', json: p.body });
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, colour: 'red', big: '!', reason: err.body.error ?? 'refused' };
    return 'offline';
  }
}

export function flushQueue(onAnswer?: (a: Answer) => void): Promise<void> {
  flushing ??= (async () => {
    for (;;) {
      const [first] = read();
      if (!first || !navigator.onLine) break;
      const a = await send(first);
      if (a === 'offline') break;
      write(read().filter((x) => x.body.deviceScanId !== first.body.deviceScanId));
      changed();
      onAnswer?.(a);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function useScanQueue() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const update = () => setPending(read().length);
    update();
    listeners.add(update);
    const online = () => void flushQueue();
    window.addEventListener('online', online);
    void flushQueue();
    return () => {
      listeners.delete(update);
      window.removeEventListener('online', online);
    };
  }, []);

  /** Queues one scan and sends what can be sent; the answer comes back when it was sent now. */
  const submit = useCallback(async (url: string, body: Record<string, unknown>): Promise<Answer | null> => {
    const p: Pending = { url, body: { ...body, deviceScanId: crypto.randomUUID(), clientAt: new Date().toISOString() } };
    write([...read(), p]);
    changed();
    let mine: Answer | null = null;
    await flushQueue();
    if (!read().some((x) => x.body.deviceScanId === p.body.deviceScanId)) {
      // sent: ask again for the stored answer (the server returns the first one)
      mine = await send(p).then((a) => (a === 'offline' ? null : a));
    }
    return mine;
  }, []);

  return { pending, submit };
}
