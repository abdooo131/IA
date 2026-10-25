import { SETTING_KEYS } from '@shiplynow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../src/seed';
import { ean13 } from '../src/seed/data';
import { zonesContaining } from '../src/zones';
import { prisma, resetDatabase } from './helpers';

const options = {
  admin: { email: 'admin@test.eg', password: 'admin-password-1', name: 'Admin' },
  demoPassword: 'demo-password-1',
};

beforeAll(async () => {
  await resetDatabase();
  await seed(prisma, options);
});

afterAll(() => prisma.$disconnect());

describe('seed', () => {
  it('loads the reference and sample data', async () => {
    expect(await prisma.governorate.count()).toBe(27);
    expect(
      (await prisma.darkStore.findMany({ orderBy: { code: 'asc' } })).map((s) => s.code),
    ).toEqual(['MAA', 'NCR', 'ZAM']);
    expect(await prisma.sku.count()).toBe(20);
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1);
    expect(await prisma.user.count({ where: { role: 'store_staff' } })).toBe(2);
    expect(await prisma.rider.count()).toBe(2);
    expect(
      await prisma.user.count({ where: { role: 'merchant', merchantId: { not: null } } }),
    ).toBe(1);
    expect(await prisma.setting.count()).toBe(SETTING_KEYS.length);
  });

  it('puts opening stock on the shelves through movements', async () => {
    const levels = await prisma.stockLevel.findMany({ include: { darkStore: true } });
    const zam = levels.filter((l) => l.darkStore.code === 'ZAM');
    expect(zam).toHaveLength(15);
    expect(levels.every((l) => l.onHand > 0 && l.reserved === 0)).toBe(true);
    const receiving = await prisma.binStock.aggregate({
      _sum: { quantity: true },
      where: { bin: { type: 'receiving' } },
    });
    expect(receiving._sum.quantity).toBe(0);
    expect(await prisma.auditLog.count()).toBe(await prisma.stockMovement.count());
  });

  it('is safe to run again', async () => {
    const before = await prisma.stockMovement.count();
    await seed(prisma, options);
    expect(await prisma.stockMovement.count()).toBe(before);
    expect(await prisma.darkStore.count()).toBe(3);
    expect(await prisma.sku.count()).toBe(20);
  });

  it('draws zones that cover their own neighbourhood and not Alexandria', async () => {
    const at = async (latitude: number, longitude: number) =>
      (await zonesContaining(prisma, { latitude, longitude })).map((z) => z.code);
    expect(await at(30.03, 31.47)).toEqual(['NCR-5S']);
    expect(await at(29.96, 31.26)).toEqual(['MAA-ALL']);
    expect(await at(30.06, 31.22)).toEqual(['ZAM-ALL']);
    expect(await at(31.2, 29.92)).toEqual([]);
  });

  it('builds valid EAN13 barcodes', () => {
    expect(ean13('400638133393')).toBe('4006381333931');
  });
});

describe('zone queries', () => {
  it('lists covering zones nearest store first, with distance', async () => {
    const { coveringZones } = await import('../src/zones');
    const [zone] = await coveringZones(prisma, { latitude: 30.03, longitude: 31.47 });
    expect(zone).toMatchObject({ zoneCode: 'NCR-5S', darkStoreCode: 'NCR' });
    expect(zone!.distanceMeters).toBeGreaterThan(0);
    expect(zone!.distanceMeters).toBeLessThan(2000);
  });

  it('returns each zone area as GeoJSON with a label point', async () => {
    const { listZonesWithArea } = await import('../src/zones');
    const zones = await listZonesWithArea(prisma);
    expect(zones).toHaveLength(3);
    expect(zones[0]!.area?.type).toBe('MultiPolygon');
    expect(zones[0]!.center).toHaveLength(2);
  });
});
