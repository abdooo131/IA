import { apiFetch } from './api-client';

/** The sessionStorage mark PushRegistrar keeps so it does not send the same device twice. */
export const PUSH_SYNC_MARK = 'shiplynow.push.synced';

/** How long signing out waits for the device to be forgotten before it goes on anyway. */
const FORGET_WAIT_MS = 3000;

/**
 * Before signing out, tells the server this device no longer belongs to the person, so the
 * next person on this phone does not get their notifications. The browser keeps its push
 * subscription (the next person who signs in sends it again under their name). Never throws
 * and never waits long: signing out must not depend on it.
 */
export async function forgetPushDevice(
  deps: {
    subscription?: () => Promise<{ endpoint: string } | null | undefined>;
    post?: (path: string, body: unknown) => Promise<unknown>;
    clearMark?: () => void;
    waitMs?: number;
  } = {},
): Promise<void> {
  const subscription = deps.subscription ?? browserSubscription;
  const post =
    deps.post ??
    ((path: string, body: unknown) =>
      apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));
  const clearMark = deps.clearMark ?? clearSyncMark;
  try {
    clearMark();
  } catch {
    // Private mode: nothing was kept.
  }
  const work = (async () => {
    try {
      const sub = await subscription();
      if (sub?.endpoint) await post('/me/push/subscriptions/remove', { endpoint: sub.endpoint });
    } catch {
      // The person signs out all the same.
    }
  })();
  await Promise.race([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, deps.waitMs ?? FORGET_WAIT_MS)),
  ]);
}

async function browserSubscription() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration || !('pushManager' in registration)) return null;
  return registration.pushManager.getSubscription();
}

function clearSyncMark() {
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PUSH_SYNC_MARK);
}
