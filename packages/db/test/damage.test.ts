import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listDamageReports, reportDamage, settleDamage } from '../src/damage';
import { merchantOwed, riderCash } from '../src/finance';
import { receive } from '../src/stock';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let staff: string;
let admin: string;
let riderId: string;
let n = 0;
const key = () => `d-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  staff = (
    await prisma.user.create({
      data: { email: 's@t.eg', name: 'Staff', role: 'store_staff', passwordHash: 'x' },
    })
  ).id;
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  const riderUser = await prisma.user.create({
    data: { email: 'r@t.eg', name: 'Rider', role: 'rider', passwordHash: 'x' },
  });
  riderId = (
    await prisma.rider.create({
      data: { userId: riderUser.id, darkStoreId: f.store.id, badgeCode: 'RDR-1' },
    })
  ).id;
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
});

afterAll(() => prisma.$disconnect());

const report = (extra: Partial<Parameters<typeof reportDamage>[1]> = {}) =>
  reportDamage(prisma, {
    darkStoreId: f.store.id,
    skuId: f.sku.id,
    fromBinId: f.shelfA.id,
    quantity: 2,
    cause: 'store_handling',
    actorUserId: staff,
    idempotencyKey: key(),
    ...extra,
  });

describe('damage settlement', () => {
  it('moves units to the damaged bin and opens a pending report, once per tap', async () => {
    const k = key();
    const first = await report({ idempotencyKey: k });
    const again = await report({ idempotencyKey: k });
    expect(again).toMatchObject({ replayed: true, report: { id: first.report.id } });
    expect(await binQty(f.damaged.id, f.sku.id)).toBe(2);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 3, reserved: 0 });
    expect(await listDamageReports(prisma, { status: 'pending' })).toHaveLength(1);
  });

  it('pays the merchant the unit price for damage in our care', async () => {
    const { report: r } = await report();
    const settled = await settleDamage(prisma, {
      reportId: r.id,
      cause: 'store_handling',
      chargeRider: false,
      actorUserId: admin,
    });
    expect(settled).toMatchObject({ compensationPiastres: 2000, riderChargePiastres: 0 });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(2000);
    await expect(
      settleDamage(prisma, {
        reportId: r.id,
        cause: 'customer',
        chargeRider: false,
        actorUserId: admin,
        note: 'x',
      }),
    ).rejects.toMatchObject({ code: 'damage_already_settled' });
    expect(await prisma.notification.count({ where: { type: 'damage_settled' } })).toBe(1);
  });

  it('charges the rider for delivery damage when admin chooses to', async () => {
    const { report: r } = await report({ cause: 'delivery', riderBadge: 'RDR-1', quantity: 1 });
    await settleDamage(prisma, {
      reportId: r.id,
      cause: 'delivery',
      chargeRider: true,
      actorUserId: admin,
    });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(1000);
    expect(await riderCash(prisma, riderId)).toBe(1000);
  });

  it('moves no money when the merchant bears it, and needs a note to change the cause', async () => {
    const { report: r } = await report({ cause: 'store_handling' });
    await expect(
      settleDamage(prisma, {
        reportId: r.id,
        cause: 'arrived_damaged',
        chargeRider: false,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'note_required' });
    await settleDamage(prisma, {
      reportId: r.id,
      cause: 'arrived_damaged',
      chargeRider: false,
      note: 'Box was crushed on arrival, see receiving photo',
      actorUserId: admin,
    });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);
    const [row] = await listDamageReports(prisma, { status: 'settled' });
    expect(row).toMatchObject({ cause: 'arrived_damaged', compensationPiastres: 0 });
  });

  it('refuses a rider charge without delivery cause or rider', async () => {
    const { report: r } = await report({ cause: 'delivery' });
    await expect(
      settleDamage(prisma, {
        reportId: r.id,
        cause: 'delivery',
        chargeRider: true,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'rider_charge_not_allowed' });
  });

  it('refuses units reserved by orders and bins of another store', async () => {
    await expect(report({ fromBinId: f.otherShelf.id })).rejects.toMatchObject({
      code: 'bin_not_found',
    });
    await expect(report({ fromBinId: f.damaged.id })).rejects.toMatchObject({
      code: 'move_not_allowed',
    });
    await expect(report({ riderBadge: 'NOPE' })).rejects.toMatchObject({ code: 'rider_not_found' });
  });
});
