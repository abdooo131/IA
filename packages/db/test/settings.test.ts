import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getSetting, setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
});

afterAll(() => prisma.$disconnect());

describe('settings', () => {
  it('falls back to the built in default', async () => {
    expect(await getSetting(prisma, 'sla.pick_minutes')).toBe(10);
  });

  it('prefers the store override, then the global value', async () => {
    await setSetting(prisma, { key: 'sla.pick_minutes', value: 12, actorUserId: null });
    await setSetting(prisma, {
      key: 'sla.pick_minutes',
      value: 8,
      scope: f.store.id,
      actorUserId: null,
    });
    expect(await getSetting(prisma, 'sla.pick_minutes')).toBe(12);
    expect(await getSetting(prisma, 'sla.pick_minutes', f.store.id)).toBe(8);
    expect(await getSetting(prisma, 'sla.pick_minutes', f.other.id)).toBe(12);
  });

  it('refuses invalid values and audits valid changes', async () => {
    await expect(
      setSetting(prisma, { key: 'stock.buffer_units', value: -1, actorUserId: null }),
    ).rejects.toThrow();
    await setSetting(prisma, { key: 'stock.buffer_units', value: 1, actorUserId: null });
    await setSetting(prisma, { key: 'stock.buffer_units', value: 2, actorUserId: null });
    const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => [e.before, e.after])).toEqual([
      [null, { value: 1 }],
      [{ value: 1 }, { value: 2 }],
    ]);
  });

  it('ignores a corrupt stored value instead of trusting it', async () => {
    await prisma.setting.create({ data: { key: 'sla.pick_minutes', value: 'soon' } });
    expect(await getSetting(prisma, 'sla.pick_minutes')).toBe(10);
  });
});
