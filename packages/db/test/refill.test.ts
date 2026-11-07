import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocation } from '../src/locations';
import { planRefill, setStockTarget } from '../src/refill';
import { setSetting } from '../src/settings';
import { move, receive } from '../src/stock';
import { approveTransfer } from '../src/transfers';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let hub: { id: string };

async function stock(darkStoreId: string, skuId: string, quantity: number) {
  const rcv =
    (await prisma.bin.findFirst({ where: { darkStoreId, type: 'receiving' } })) ??
    (await prisma.bin.create({ data: { darkStoreId, code: 'RCV-X', type: 'receiving' } }));
  const shelf = await prisma.bin.findFirstOrThrow({ where: { darkStoreId, type: 'pickable' } });
  await receive(prisma, { skuId, binId: rcv.id, quantity });
  await move(prisma, { skuId, fromBinId: rcv.id, toBinId: shelf.id, quantity });
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  hub = await createLocation(prisma, {
    kind: 'hub',
    code: 'HUB',
    nameEn: 'Hub',
    nameAr: 'مركز',
    addressEn: 'Industrial zone',
    addressAr: 'المنطقة الصناعية',
    governorateId: 1,
    latitude: 30.1,
    longitude: 31.3,
    shelves: 2,
    actorUserId: admin,
  });
  await setSetting(prisma, { key: 'refill.default_min_units', value: 3, actorUserId: admin });
  await setSetting(prisma, { key: 'refill.default_max_units', value: 10, actorUserId: admin });
});

afterAll(() => prisma.$disconnect());

const linesOf = (transferId: string) =>
  prisma.transferLine.findMany({ where: { transferId }, select: { skuId: true, quantity: true } });

describe('automatic refill', () => {
  it('fills low stores from the hub, one draft per trip, once a day', async () => {
    await stock(hub.id, f.sku.id, 30);
    await stock(f.store.id, f.sku.id, 1);
    // OTH has nothing: it needs 10, TST needs 9.
    const plan = await planRefill(prisma, { day: '2026-11-01' });
    expect(plan.created).toHaveLength(2);
    const drafts = await prisma.transfer.findMany({ where: { refillDay: '2026-11-01' } });
    expect(drafts.every((d) => d.status === 'draft' && d.fromId === hub.id)).toBe(true);
    const toTst = drafts.find((d) => d.toId === f.store.id)!;
    expect(await linesOf(toTst.id)).toEqual([{ skuId: f.sku.id, quantity: 9 }]);
    expect((await planRefill(prisma, { day: '2026-11-01' })).alreadyPlanned).toBe(true);

    // Next day: what is already coming counts, so nothing new is proposed.
    expect((await planRefill(prisma, { day: '2026-11-02' })).created).toHaveLength(0);
  });

  it('uses a donor store when the hub is short, only its excess, through the hub', async () => {
    await stock(f.store.id, f.sku.id, 16); // max 10, so 6 spare
    const plan = await planRefill(prisma, { day: '2026-11-03' });
    expect(plan.created).toHaveLength(1);
    const draft = await prisma.transfer.findFirstOrThrow({ where: { refillDay: '2026-11-03' } });
    expect(draft).toMatchObject({
      fromId: f.store.id,
      toId: hub.id,
      finalDestinationId: f.other.id,
    });
    expect(await linesOf(draft.id)).toEqual([{ skuId: f.sku.id, quantity: 6 }]);
    await approveTransfer(prisma, { transferId: draft.id, actorUserId: admin });
  });

  it('follows a product level over the default, and does nothing without a hub', async () => {
    await stock(hub.id, f.sku.id, 30);
    await setStockTarget(prisma, {
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      minUnits: 0,
      maxUnits: 0,
      actorUserId: admin,
    });
    await setStockTarget(prisma, {
      darkStoreId: f.other.id,
      skuId: f.sku.id,
      minUnits: 2,
      maxUnits: 4,
      actorUserId: admin,
    });
    await planRefill(prisma, { day: '2026-11-04' });
    const drafts = await prisma.transfer.findMany({ where: { refillDay: '2026-11-04' } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.toId).toBe(f.other.id);
    expect(await linesOf(drafts[0]!.id)).toEqual([{ skuId: f.sku.id, quantity: 4 }]);
    await expect(
      setStockTarget(prisma, {
        darkStoreId: f.store.id,
        skuId: f.sku.id,
        minUnits: 5,
        maxUnits: 1,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'min_above_max' });

    await prisma.darkStore.update({ where: { id: hub.id }, data: { isActive: false } });
    expect((await planRefill(prisma, { day: '2026-11-05' })).created).toHaveLength(0);
  });
});
