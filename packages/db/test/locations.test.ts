import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createManifest } from '../src/inbound';
import { addShelves, createLocation } from '../src/locations';
import { createOrder } from '../src/orders';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;

const hub = () =>
  createLocation(prisma, {
    kind: 'hub',
    code: 'hub',
    nameEn: 'Main hub',
    nameAr: 'مركز الفرز',
    addressEn: 'Industrial zone',
    addressAr: 'المنطقة الصناعية',
    governorateId: 1,
    latitude: 30.1,
    longitude: 31.3,
    shelves: 3,
    actorUserId: admin,
  });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
});

afterAll(() => prisma.$disconnect());

describe('locations', () => {
  it('opens a hub with hours and every bin it needs, and adds shelves after the last one', async () => {
    const created = await hub();
    expect(created).toMatchObject({ kind: 'hub', code: 'HUB' });
    const bins = await prisma.bin.findMany({
      where: { darkStoreId: created.id },
      orderBy: { code: 'asc' },
    });
    expect(bins.map((b) => `${b.code}:${b.type}`)).toEqual([
      'A-01:pickable',
      'A-02:pickable',
      'A-03:pickable',
      'DMG-01:damaged',
      'HLD-01:held',
      'RCV-01:receiving',
    ]);
    expect(await prisma.storeHours.count({ where: { darkStoreId: created.id } })).toBe(7);
    expect(
      await addShelves(prisma, { darkStoreId: created.id, count: 2, actorUserId: admin }),
    ).toEqual({
      added: ['A-04', 'A-05'],
    });
    await expect(hub()).rejects.toMatchObject({ code: 'code_taken' });
  });

  it('sends merchant shipments to the hub once one exists, and a hub takes no orders', async () => {
    const h = await hub();
    const ship = (darkStoreId: string, reference: string) =>
      createManifest(prisma, {
        merchantId: f.merchant.id,
        darkStoreId,
        reference,
        lines: [{ skuId: f.sku.id, expectedQty: 1 }],
        actorUserId: admin,
      });
    await expect(ship(f.store.id, 'R1')).rejects.toMatchObject({ code: 'shipments_go_to_hub' });
    await expect(ship(h.id, 'R2')).resolves.toMatchObject({ darkStoreId: h.id });
    await expect(
      createOrder(prisma, {
        merchantId: f.merchant.id,
        darkStoreId: h.id,
        source: 'manual',
        customerName: 'x',
        customerPhone: '01012345678',
        addressText: 'x street',
        paymentMethod: 'cod',
        deliveryFeePiastres: 0,
        items: [{ skuId: f.sku.id, quantity: 1 }],
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'hub_takes_no_orders' });
  });
});
