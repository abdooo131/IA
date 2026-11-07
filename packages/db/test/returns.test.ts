import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../src/settings';
import { merchantOwed } from '../src/finance';
import {
  cancelReturn,
  createReturn,
  getReturnDetail,
  handOverReturn,
  pickForReturn,
  returnableStock,
} from '../src/returns';
import { move, receive, reserve } from '../src/stock';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let merchantUser: string;
let staff: string;
let n = 0;
const key = () => `r-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  merchantUser = (
    await prisma.user.create({
      data: {
        email: 'm@t.eg',
        name: 'Merchant',
        role: 'merchant',
        passwordHash: 'x',
        merchantId: f.merchant.id,
      },
    })
  ).id;
  staff = (
    await prisma.user.create({
      data: { email: 's@t.eg', name: 'Staff', role: 'store_staff', passwordHash: 'x' },
    })
  ).id;
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
  await receive(prisma, { skuId: f.sku.id, binId: f.receiving.id, quantity: 3 });
  await move(prisma, {
    skuId: f.sku.id,
    fromBinId: f.receiving.id,
    toBinId: f.damaged.id,
    quantity: 2,
  });
});

afterAll(() => prisma.$disconnect());

const request = (lines: Parameters<typeof createReturn>[1]['lines']) =>
  createReturn(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    lines,
    actorUserId: merchantUser,
  });

const pickOne = (returnId: string, extra: { binId?: string; quantity?: number } = {}) =>
  pickForReturn(prisma, {
    returnId,
    darkStoreId: f.store.id,
    skuId: f.sku.id,
    quantity: extra.quantity ?? 1,
    binId: extra.binId,
    actorUserId: staff,
    idempotencyKey: key(),
  });

describe('returns to the merchant', () => {
  it('shows what can be taken back, per source', async () => {
    expect(await returnableStock(prisma, f.merchant.id, f.store.id)).toEqual([
      expect.objectContaining({ sku: 'SKU-1', sellable: 5, damaged: 2, held: 0 }),
    ]);
  });

  it('reserves sellable units at once, so orders cannot sell them', async () => {
    const ret = await request([{ skuId: f.sku.id, source: 'sellable', quantity: 4 }]);
    expect(ret.reference).toBe('RET-1001');
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 4 });
    await expect(
      reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 }),
    ).rejects.toMatchObject({ code: 'insufficient_stock' });
    await expect(
      request([{ skuId: f.sku.id, source: 'sellable', quantity: 2 }]),
    ).rejects.toMatchObject({ code: 'not_enough_available' });
  });

  it('refuses more damaged units than the damaged bin holds, counting open returns', async () => {
    await request([{ skuId: f.sku.id, source: 'damaged', quantity: 2 }]);
    await expect(
      request([{ skuId: f.sku.id, source: 'damaged', quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'not_enough_available' });
  });

  it('picks by scan, becomes ready, then is handed over with the fee charged', async () => {
    await setSetting(prisma, {
      key: 'fee.return_per_unit_piastres',
      value: 300,
      actorUserId: staff,
    });
    const ret = await request([
      { skuId: f.sku.id, source: 'sellable', quantity: 2 },
      { skuId: f.sku.id, source: 'damaged', quantity: 1 },
    ]);
    expect(await pickOne(ret.id)).toMatchObject({ status: 'picking', bin: 'A-01' });
    await expect(pickOne(ret.id, { quantity: 5 })).rejects.toMatchObject({ code: 'over_pick' });
    await pickOne(ret.id, { binId: f.shelfA.id });
    expect(await pickOne(ret.id, { binId: f.damaged.id })).toMatchObject({ status: 'ready' });

    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 3, reserved: 0 });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(3);
    expect(await binQty(f.damaged.id, f.sku.id)).toBe(1);
    await expect(
      cancelReturn(prisma, { returnId: ret.id, actorUserId: merchantUser }),
    ).rejects.toMatchObject({
      code: 'return_not_cancellable',
    });

    expect(
      await handOverReturn(prisma, {
        returnId: ret.id,
        darkStoreId: f.store.id,
        collectedBy: 'Mona (driver)',
        actorUserId: staff,
      }),
    ).toEqual({ status: 'collected', units: 3 });
    // 3 units at 3 EGP: the merchant owes us 9 EGP.
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-900);
    const detail = await getReturnDetail(prisma, ret.id);
    expect(detail).toMatchObject({ status: 'collected', collectedBy: 'Mona (driver)' });
    const movements = await prisma.stockMovement.findMany({ where: { returnId: ret.id } });
    expect(movements.map((m) => m.type)).toEqual(['dispatch', 'dispatch', 'dispatch']);
    await expect(
      handOverReturn(prisma, {
        returnId: ret.id,
        darkStoreId: f.store.id,
        collectedBy: 'x',
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'invalid_return_state' });
  });

  it('applies a repeated scan once', async () => {
    const ret = await request([{ skuId: f.sku.id, source: 'sellable', quantity: 2 }]);
    const input = {
      returnId: ret.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: 'same-tap',
    };
    await pickForReturn(prisma, input);
    expect(await pickForReturn(prisma, input)).toMatchObject({ replayed: true });
    const line = await prisma.merchantReturnLine.findFirstOrThrow({ where: { returnId: ret.id } });
    expect(line.pickedQty).toBe(1);
  });

  it('cancels before picking and puts the units back on sale', async () => {
    const ret = await request([{ skuId: f.sku.id, source: 'sellable', quantity: 3 }]);
    await expect(
      cancelReturn(prisma, {
        returnId: ret.id,
        actorUserId: merchantUser,
        merchantId: f.merchant.id,
      }),
    ).resolves.toEqual({ status: 'cancelled' });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 0 });
  });

  it('refuses products of another merchant and bins of another store', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    const foreign = await prisma.sku.create({
      data: { merchantId: other.id, sku: 'X', titleEn: 'X', titleAr: 'X', pricePiastres: 1 },
    });
    await expect(
      request([{ skuId: foreign.id, source: 'sellable', quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'sku_not_found' });
    const ret = await request([{ skuId: f.sku.id, source: 'sellable', quantity: 1 }]);
    await expect(pickOne(ret.id, { binId: f.otherShelf.id })).rejects.toMatchObject({
      code: 'bin_not_found',
    });
    await expect(pickOne(ret.id, { binId: f.receiving.id })).rejects.toMatchObject({
      code: 'bin_not_allowed',
    });
  });
});
