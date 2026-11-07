'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { pushSupported, subscriptionBody } from '@/lib/push';

/**
 * Registers the service worker (production builds with push configured) and, for a signed in
 * person who already allowed notifications, tells the server this device's subscription and
 * language again, so a renewed subscription or a language change reaches the server.
 */
export function PushRegistrar({ signedIn }: { signedIn: boolean }) {
  const locale = useLocale();
  useEffect(() => {
    if (!pushSupported()) return;
    let stopped = false;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (stopped || !signedIn || Notification.permission !== 'granted') return;
        const sub = await registration.pushManager.getSubscription();
        if (!sub) return;
        const mark = `${sub.endpoint}|${locale}`;
        if (readMark() === mark) return;
        const res = await fetch('/api/me/push/subscriptions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscriptionBody(sub, locale)),
        });
        if (res.ok) writeMark(mark);
      } catch {
        // Notifications are a convenience; the app works without them.
      }
    })();
    return () => {
      stopped = true;
    };
  }, [signedIn, locale]);
  return null;
}

const KEY = 'shiplynow.push.synced';
function readMark() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeMark(value: string) {
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    // Private mode: the next page sends it again, which is harmless.
  }
}
