import { cairoClock, cairoDay } from '@shiplynow/shared';
import type { Db } from './client';
import { getSetting } from './settings';

// The nightly clean up of working tables that otherwise grow without end (review step 4).
// It deletes only rows nothing reads any more, each after its own cleanup.* setting:
//  - refresh tokens that expired (an expired token can never be used; revoked tokens that
//    have not expired yet are kept, so presenting one still signs the person out everywhere),
//  - Google "not found" answers (they are ignored after a day; found points are kept, since
//    they place deliveries),
//  - merchant emails that were sent (failed ones stay for finance to resend),
//  - merchant notifications already read (unread ones stay).
// It never touches append only business records (ledger, stock_movements, order_events,
// audit_log) nor alerts (the KPIs count late alerts). Shopify logs and finished Shopify calls
// have their own daily prune (pruneShopifyRecords), push_sent is kept two days by
// dispatchPush and unlinked finance uploads a day by purgeUnlinkedUploads. Deleting twice
// deletes nothing more, so overlapping runs and other instances are harmless.

const DAY_MS = 24 * 3600_000;

export interface CleanupResult {
  refreshTokens: number;
  geocodeNotFound: number;
  emailsSent: number;
  notificationsRead: number;
}

/** Deletes the old working rows (see above). */
export async function cleanUpTables(db: Db, now: Date = new Date()): Promise<CleanupResult> {
  const before = async (
    key:
      | 'cleanup.refresh_token_days'
      | 'cleanup.geocode_not_found_days'
      | 'cleanup.email_sent_days'
      | 'cleanup.notification_read_days',
  ) => new Date(now.getTime() - (await getSetting(db, key)) * DAY_MS);

  const tokens = await db.refreshToken.deleteMany({
    where: { expiresAt: { lt: await before('cleanup.refresh_token_days') } },
  });
  const geocode = await db.geocodeCache.deleteMany({
    where: { latitude: null, createdAt: { lt: await before('cleanup.geocode_not_found_days') } },
  });
  const emails = await db.emailOutbox.deleteMany({
    where: { status: 'sent', sentAt: { lt: await before('cleanup.email_sent_days') } },
  });
  const notifications = await db.notification.deleteMany({
    where: { readAt: { lt: await before('cleanup.notification_read_days') } },
  });
  return {
    refreshTokens: tokens.count,
    geocodeNotFound: geocode.count,
    emailsSent: emails.count,
    notificationsRead: notifications.count,
  };
}

/**
 * Whether the nightly clean up is due: from cleanup.run_hour (Cairo) on a Cairo day it has not
 * run on yet in this instance (`doneDay`). Returns the Cairo day to remember, or null.
 */
export async function cleanupDue(
  db: Db,
  now: Date,
  doneDay: string | null,
): Promise<string | null> {
  const day = cairoDay(now);
  if (doneDay === day) return null;
  const hour = Math.floor(cairoClock(now).minute / 60);
  if (hour < (await getSetting(db, 'cleanup.run_hour'))) return null;
  return day;
}
