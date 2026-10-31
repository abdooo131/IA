/**
 * A random key for one user action, sent as the idempotency key so a double tap or a
 * retried request is applied once. crypto.randomUUID only exists on https, but phones on
 * the shop wifi may use plain http, so this falls back to getRandomValues.
 */
export function newActionKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
