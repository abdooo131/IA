'use client';
// What keeps the courier app working on a weak line: the phone's position (sent to the hub
// every minute and attached to each stop), a queue of stop results kept on the phone while
// there is no signal, and the last run kept on the phone so it can still be read offline.
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

// ---------------------------------------------------------------- location

let fix: { lat: number; lng: number; accuracy: number; at: number } | null = null;

/** The phone's last position from the last 5 minutes, ready to send with a stop result. */
export function here(): { lat?: number; lng?: number } {
  if (!fix || Date.now() - fix.at > 5 * 60_000) return {};
  return { lat: fix.lat, lng: fix.lng };
}

/** Watches the phone's position while the app is open and sends it to the hub now and then. */
export function useLocationPing() {
  const [state, setState] = useState<'off' | 'on' | 'denied'>('off');
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let every = 60;
    let lastSent = 0;
    api<{ pingSeconds: number }>('/courier/config')
      .then((c) => (every = c.pingSeconds))
      .catch(() => undefined);
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          at: Date.now(),
        };
        setState('on');
        if (Date.now() - lastSent >= every * 1000) {
          lastSent = Date.now();
          api('/courier/ping', {
            body: { lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy) },
          }).catch(() => (lastSent = 0));
        }
      },
      (e) => setState(e.code === e.PERMISSION_DENIED ? 'denied' : 'off'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);
  return state;
}

// ---------------------------------------------------------------- offline queue

const QUEUE = 'shiply.courier.queue';
const RUN = 'shiply.courier.run';
const EVENT = 'shiply-queue';

export interface Queued {
  path: string;
  body: unknown;
  /** The stop it belongs to and what it will become once sent. */
  itemId: string;
  result: string;
  at: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const queued = () => read<Queued[]>(QUEUE, []);
const setQueue = (q: Queued[]) => {
  write(QUEUE, q);
  window.dispatchEvent(new Event(EVENT));
};

/** No signal, or the server could not be reached: worth keeping and sending later. */
function offline(e: unknown) {
  if (!(e instanceof ApiError)) return true;
  return e.status >= 502 || e.status === 0;
}

/**
 * Sends a stop result. With no signal it is kept on the phone and sent later, and the screen
 * shows the stop as done meanwhile. Errors from the server (wrong amount, wrong code) still show.
 */
export async function sendStop(
  itemId: string,
  action: string,
  body: unknown,
  result: string,
): Promise<'sent' | 'queued'> {
  const path = `/courier/stops/${itemId}/${action}`;
  try {
    await api(path, { body });
    return 'sent';
  } catch (e) {
    if (!offline(e)) throw e;
    if (!write(QUEUE, [...queued(), { path, body, itemId, result, at: Date.now() }]))
      throw new Error(
        'No signal, and the phone has no room to keep this. Try again when you have signal',
      );
    window.dispatchEvent(new Event(EVENT));
    return 'queued';
  }
}

let flushing = false;

/** Sends what was kept on the phone, oldest first. Stops at the first send that still has no signal. */
export async function flushQueue(): Promise<{ sent: number; rejected: string[] }> {
  if (flushing) return { sent: 0, rejected: [] };
  flushing = true;
  let sent = 0;
  const rejected: string[] = [];
  try {
    for (const q of queued()) {
      try {
        await api(q.path, { body: q.body });
        sent++;
      } catch (e) {
        if (offline(e)) break;
        // The server said no (already done from another phone, or a wrong code): drop it and say so.
        rejected.push(e instanceof Error ? e.message : 'Rejected');
      }
      setQueue(queued().filter((x) => x.at !== q.at));
    }
  } finally {
    flushing = false;
  }
  return { sent, rejected };
}

/** How many results wait on the phone, and a sender that retries on signal and every 30 seconds. */
export function useQueue(onFlushed?: () => void) {
  const [list, setList] = useState<Queued[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setList(queued());
    update();
    const flush = async () => {
      if (!queued().length) return;
      const r = await flushQueue();
      if (r.rejected.length) setRejected((x) => [...x, ...r.rejected]);
      if (r.sent || r.rejected.length) onFlushed?.();
    };
    void flush();
    window.addEventListener(EVENT, update);
    window.addEventListener('online', flush);
    const timer = setInterval(flush, 30_000);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('online', flush);
      clearInterval(timer);
    };
  }, []);
  return { list, rejected, clearRejected: () => setRejected([]) };
}

/** Keeps the last run on the phone so it can still be read with no signal. */
export const saveRun = (run: unknown) => write(RUN, { run, at: Date.now() });
export const savedRun = <T>() => read<{ run: T; at: number } | null>(RUN, null);

/** Opens the app shell from the phone's cache when there is no signal. */
export function registerOfflineShell() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/parcels-sw.js', { scope: '/parcels/courier' })
    .catch(() => undefined);
}
