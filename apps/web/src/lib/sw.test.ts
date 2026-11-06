import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The service worker (public/sw.js) is plain JavaScript; it runs here against a fake worker
// so its handlers are checked without a real push service or browser.

const SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://app.shiplynow.test';

type Handler = (event: unknown) => void;

function worker(windows: { url: string; focus: () => unknown; navigate?: unknown }[] = []) {
  const handlers: Record<string, Handler> = {};
  const sw = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, fn: Handler) => (handlers[name] = fn),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: vi.fn(async () => undefined),
      pushManager: { subscribe: vi.fn() },
    },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
    fetch: vi.fn(async () => ({ ok: true })),
  };
  new Function('self', SOURCE)(sw);
  /** Fires an event and waits for what it handed to waitUntil. */
  const fire = async (name: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    handlers[name]!({ ...event, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  return { sw, fire };
}

const pushData = (body: unknown) => ({
  json: () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: () => String(body),
});

describe('service worker', () => {
  it('shows the notification the server sent', async () => {
    const { sw, fire } = worker();
    await fire('push', {
      data: pushData({
        title: 'طلب جديد SN-1001',
        body: 'اقبل الطلب',
        url: '/store/s1/orders/o1',
        tag: 'order-o1',
        urgent: true,
      }),
    });
    expect(sw.registration.showNotification).toHaveBeenCalledWith(
      'طلب جديد SN-1001',
      expect.objectContaining({
        body: 'اقبل الطلب',
        tag: 'order-o1',
        renotify: true,
        requireInteraction: true,
        data: { url: '/store/s1/orders/o1' },
      }),
    );
  });

  it('still shows something for a message that is not JSON', async () => {
    const { sw, fire } = worker();
    await fire('push', { data: pushData('not json {') });
    expect(sw.registration.showNotification).toHaveBeenCalledWith(
      'Shiply Now',
      expect.objectContaining({ body: 'not json {', data: { url: '/' } }),
    );
  });

  it('focuses a window already on the page, else moves one there, else opens one', async () => {
    const close = vi.fn();
    const on = { url: `${ORIGIN}/rider`, focus: vi.fn() };
    let w = worker([on]);
    await w.fire('notificationclick', { notification: { close, data: { url: '/rider' } } });
    expect(close).toHaveBeenCalled();
    expect(on.focus).toHaveBeenCalled();

    const moved = { focus: vi.fn() };
    const other = { url: `${ORIGIN}/home`, focus: vi.fn(), navigate: vi.fn(async () => moved) };
    w = worker([other]);
    await w.fire('notificationclick', { notification: { close, data: { url: '/tickets/t1' } } });
    expect(other.navigate).toHaveBeenCalledWith(`${ORIGIN}/tickets/t1`);
    expect(moved.focus).toHaveBeenCalled();

    w = worker([]);
    await w.fire('notificationclick', {
      notification: { close, data: { url: 'https://evil.example/phish' } },
    });
    expect(w.sw.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it('sends a renewed subscription to the server', async () => {
    const { sw, fire } = worker();
    await fire('pushsubscriptionchange', {
      oldSubscription: { endpoint: 'https://push.test/old', options: {} },
      newSubscription: {
        toJSON: () => ({ endpoint: 'https://push.test/new', keys: { p256dh: 'p', auth: 'a' } }),
      },
    });
    expect(sw.fetch).toHaveBeenCalledWith(
      '/api/me/push/subscriptions',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    const body = JSON.parse(
      (sw.fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body).toEqual({
      endpoint: 'https://push.test/new',
      keys: { p256dh: 'p', auth: 'a' },
      replaces: 'https://push.test/old',
    });
  });
});
