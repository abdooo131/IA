import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Failed sign ins allowed per account, and per address, within the window. */
const PER_ACCOUNT = 5;
const PER_ADDRESS = 20;
const WINDOW_MS = 15 * 60_000;

/**
 * Slows password guessing: after 5 wrong passwords for one account, or 20 from one address,
 * sign in is refused for the rest of a 15 minute window. Kept in memory, which suits the
 * pilot's single API process; a restart forgets the counts.
 */
@Injectable()
export class LoginThrottleService {
  private readonly failures = new Map<string, number[]>();
  /** Replaced in tests to move time forward. */
  now = () => Date.now();

  private recent(key: string) {
    const since = this.now() - WINDOW_MS;
    const list = (this.failures.get(key) ?? []).filter((t) => t > since);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Throws 429 when the account or the address has used up its attempts. */
  check(email: string, address: string | null) {
    const keys: [string, number][] = [[`account:${email.toLowerCase()}`, PER_ACCOUNT]];
    if (address) keys.push([`address:${address}`, PER_ADDRESS]);
    for (const [key, limit] of keys) {
      const list = this.recent(key);
      if (list.length >= limit) {
        const retryAfterSeconds = Math.ceil((list[0]! + WINDOW_MS - this.now()) / 1000);
        throw new HttpException(
          { error: 'too_many_attempts', retryAfterSeconds },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  failed(email: string, address: string | null) {
    const at = this.now();
    for (const key of [`account:${email.toLowerCase()}`, address && `address:${address}`]) {
      if (!key) continue;
      this.failures.set(key, [...this.recent(key), at]);
    }
  }

  succeeded(email: string) {
    this.failures.delete(`account:${email.toLowerCase()}`);
  }
}

/**
 * The visitor's address. Render's proxy appends the address it saw to X-Forwarded-For and the
 * web app passes the header on, so the last entry is the one a visitor cannot fake.
 */
export function clientAddress(forwardedFor: string | string[] | undefined, fallback?: string) {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const last = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .pop();
  return last ?? fallback ?? null;
}
