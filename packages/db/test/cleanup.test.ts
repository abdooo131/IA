import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanUpTables, cleanupDue } from '../src/cleanup';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

const NOW = new Date('2026-11-17T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000);

let fx: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  await resetDatabase();
  fx = await createFixture();
});
afterAll(() => prisma.$disconnect());

describe('nightly table clean up', () => {
  it('deletes only old working rows, after each cleanup setting', async () => {
    const user = await prisma.user.create({
      data: { email: 'a@test', passwordHash: 'x', name: 'A', role: 'admin' },
    });
    const token = (hash: string, expiresAt: Date, revokedAt: Date | null = null) =>
      prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt, revokedAt },
      });
    await token('old', daysAgo(8)); // expired 8 days ago: deleted (default 7)
    await token('recent', daysAgo(2)); // expired 2 days ago: kept
    await token('revoked', new Date(NOW.getTime() + 3600_000), daysAgo(1)); // revoked, not expired: kept

    await prisma.geocodeCache.createMany({
      data: [
        { addressKey: 'missing old', latitude: null, method: 'google', createdAt: daysAgo(10) },
        { addressKey: 'missing new', latitude: null, method: 'google', createdAt: daysAgo(1) },
        {
          addressKey: 'found old',
          latitude: 30,
          longitude: 31,
          method: 'google',
          createdAt: daysAgo(400),
        },
      ],
    });

    const email = (key: string, status: 'sent' | 'failed', sentAt: Date | null) =>
      prisma.emailOutbox.create({
        data: {
          kind: 'statement',
          merchantId: fx.merchant.id,
          toEmails: ['m@test'],
          language: 'en',
          subject: 's',
          html: 'h',
          text: 't',
          idempotencyKey: key,
          status,
          sentAt,
          createdAt: daysAgo(400),
        },
      });
    await email('sent old', 'sent', daysAgo(181));
    await email('sent new', 'sent', daysAgo(10));
    await email('failed old', 'failed', null);

    const note = (readAt: Date | null) =>
      prisma.notification.create({
        data: { merchantId: fx.merchant.id, type: 'x', data: {}, readAt, createdAt: daysAgo(500) },
      });
    await note(daysAgo(366)); // read long ago: deleted
    await note(daysAgo(30)); // read lately: kept
    await note(null); // never read: kept

    const first = await cleanUpTables(prisma, NOW);
    expect(first).toEqual({
      refreshTokens: 1,
      geocodeNotFound: 1,
      emailsSent: 1,
      notificationsRead: 1,
    });
    expect((await prisma.refreshToken.findMany()).map((t) => t.tokenHash).sort()).toEqual([
      'recent',
      'revoked',
    ]);
    expect((await prisma.geocodeCache.findMany()).map((g) => g.addressKey).sort()).toEqual([
      'found old',
      'missing new',
    ]);
    expect((await prisma.emailOutbox.findMany()).map((e) => e.idempotencyKey).sort()).toEqual([
      'failed old',
      'sent new',
    ]);
    expect(await prisma.notification.count()).toBe(2);

    // Running again deletes nothing more.
    expect(await cleanUpTables(prisma, NOW)).toEqual({
      refreshTokens: 0,
      geocodeNotFound: 0,
      emailsSent: 0,
      notificationsRead: 0,
    });

    // A shorter setting reaches the rows kept so far.
    await setSetting(prisma, { key: 'cleanup.refresh_token_days', value: 1, actorUserId: null });
    expect((await cleanUpTables(prisma, NOW)).refreshTokens).toBe(1);
  });

  it('runs once a Cairo day, from cleanup.run_hour', async () => {
    // 00:30 Cairo (UTC+2 in November): before the default hour 3.
    expect(await cleanupDue(prisma, new Date('2026-11-16T22:30:00Z'), null)).toBeNull();
    // 03:10 Cairo: due, once.
    const at = new Date('2026-11-17T01:10:00Z');
    expect(await cleanupDue(prisma, at, null)).toBe('2026-11-17');
    expect(await cleanupDue(prisma, at, '2026-11-17')).toBeNull();
    await setSetting(prisma, { key: 'cleanup.run_hour', value: 4, actorUserId: null });
    expect(await cleanupDue(prisma, at, null)).toBeNull();
  });
});
