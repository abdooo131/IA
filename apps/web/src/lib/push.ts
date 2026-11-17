/** Helpers for web push in the browser (Notifications page and the registrar). */

/** The VAPID public key (base64url) as the bytes PushManager.subscribe expects. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** iPhone or iPad (iPadOS reports a Mac with touch). */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export type DeviceKind = 'iphone' | 'ipad' | 'android' | 'windows' | 'mac' | 'linux' | 'other';
export type BrowserKind = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';

/** What a device is, from its user agent, so the person recognises it in the list. */
export function deviceOf(userAgent: string | null | undefined): {
  device: DeviceKind;
  browser: BrowserKind;
} {
  const ua = userAgent ?? '';
  const device: DeviceKind = /iPhone|iPod/.test(ua)
    ? 'iphone'
    : /iPad/.test(ua)
      ? 'ipad'
      : /Android/.test(ua)
        ? 'android'
        : /Windows/.test(ua)
          ? 'windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'mac'
            : /Linux/.test(ua)
              ? 'linux'
              : 'other';
  const browser: BrowserKind = /SamsungBrowser/.test(ua)
    ? 'samsung'
    : /Edg\//.test(ua)
      ? 'edge'
      : /Firefox|FxiOS/.test(ua)
        ? 'firefox'
        : /Chrome|CriOS/.test(ua)
          ? 'chrome'
          : /Safari/.test(ua)
            ? 'safari'
            : 'other';
  return { device, browser };
}

/** The subscription as the API takes it. */
export function subscriptionBody(sub: PushSubscription, lang: string) {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    lang: lang === 'ar' ? 'ar' : 'en',
  };
}

/** The browser can receive web push (on iPhone only once added to the Home Screen). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
