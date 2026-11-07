/* Shiply Now service worker: shows web push notifications and opens their page when tapped.
 * It caches nothing (every screen needs live data). Plain JavaScript with no build step; the
 * handlers are plain functions so test/sw.test.ts can run them with a fake worker. */

/** The notification the server sent: { title, body, url, tag, urgent }. */
function readPush(data) {
  let body = {};
  if (data) {
    try {
      body = data.json();
    } catch {
      body = { body: data.text() };
    }
  }
  return {
    title: body.title || 'Shiply Now',
    body: body.body || '',
    url: typeof body.url === 'string' ? body.url : '/',
    tag: typeof body.tag === 'string' ? body.tag : undefined,
    urgent: body.urgent === true,
  };
}

/** Only pages of this app are opened, whatever the message says. */
function safeUrl(sw, url) {
  try {
    const target = new URL(url || '/', sw.location.origin);
    return target.origin === sw.location.origin ? target.href : sw.location.origin + '/';
  } catch {
    return sw.location.origin + '/';
  }
}

function onPush(sw, event) {
  const push = readPush(event.data);
  return sw.registration.showNotification(push.title, {
    body: push.body,
    tag: push.tag,
    // A newer message about the same thing replaces the older one and still rings.
    renotify: Boolean(push.tag),
    requireInteraction: push.urgent,
    icon: '/brand/app-icon-192.png',
    badge: '/brand/app-icon-192.png',
    dir: 'auto',
    data: { url: push.url },
  });
}

/** Focuses a window already showing the page, else moves an open window there, else opens one. */
async function onNotificationClick(sw, event) {
  event.notification.close();
  const url = safeUrl(sw, event.notification.data && event.notification.data.url);
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const same = windows.find((w) => w.url === url);
  if (same) return same.focus();
  const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
  if (open && 'navigate' in open) {
    try {
      const moved = await open.navigate(url);
      if (moved) return moved.focus();
    } catch {
      // A window this worker does not control cannot be moved: open a new one.
    }
  }
  return sw.clients.openWindow(url);
}

/** The browser renewed the subscription: tell the server (the app does it too when opened). */
async function onSubscriptionChange(sw, event) {
  const old = event.oldSubscription;
  const options = old && old.options;
  const fresh =
    event.newSubscription ||
    (options && options.applicationServerKey
      ? await sw.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: options.applicationServerKey,
        })
      : null);
  if (!fresh) return;
  const json = fresh.toJSON();
  await sw.fetch('/api/me/push/subscriptions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      replaces: old ? old.endpoint : undefined,
    }),
  });
}

function install(sw) {
  sw.addEventListener('install', () => sw.skipWaiting());
  sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));
  sw.addEventListener('push', (event) => event.waitUntil(onPush(sw, event)));
  sw.addEventListener('notificationclick', (event) =>
    event.waitUntil(onNotificationClick(sw, event)),
  );
  sw.addEventListener('pushsubscriptionchange', (event) =>
    event.waitUntil(onSubscriptionChange(sw, event).catch(() => undefined)),
  );
}

install(self);
