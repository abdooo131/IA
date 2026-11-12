import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { adjust, move, pick, receive, release, reserve, StockError } from '../src/stock';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

type Fixture = Awaited<ReturnType<typeof createFixture>>;

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
});

afterAll(() => prisma.$disconnect());

async function expectStockError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(StockError);
  await expect(promise).rejects.toMatchObject({ code });
}

/** Puts `quantity` units on shelf A ready to sell. */
async function stockShelf(quantity: number, skuId = f.sku.id) {
  await receive(prisma, { skuId, binId: f.shelfA.id, quantity });
}

describe('receive', () => {
  it('into a pickable bin adds to on hand', async () => {
    const result = await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
    expect(result.level).toEqual({ onHand: 5, reserved: 0 });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(5);
    expect(result.movement).toMatchObject({ type: 'receive', quantity: 5, toBinId: f.shelfA.id });
  });

  it('into the receiving bin is not sellable yet', async () => {
    const result = await receive(prisma, { skuId: f.sku.id, binId: f.receiving.id, quantity: 5 });
    expect(result.level).toBeNull();
    expect(await level(f.store.id, f.sku.id)).toBeNull();
    expect(await binQty(f.receiving.id, f.sku.id)).toBe(5);
  });

  it('refuses zero, negative and fractional quantities', async () => {
    for (const quantity of [0, -1, 1.5]) {
      await expectStockError(
        receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity }),
        'invalid_quantity',
      );
    }
  });
});

describe('move', () => {
  it('put away from receiving to a shelf makes units sellable', async () => {
    await receive(prisma, { skuId: f.sku.id, binId: f.receiving.id, quantity: 8 });
    const result = await move(prisma, {
      skuId: f.sku.id,
      fromBinId: f.receiving.id,
      toBinId: f.shelfA.id,
      quantity: 8,
    });
    expect(result.level).toEqual({ onHand: 8, reserved: 0 });
    expect(await binQty(f.receiving.id, f.sku.id)).toBe(0);
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(8);
  });

  it('shelf to shelf does not change on hand', async () => {
    await stockShelf(4);
    const result = await move(prisma, {
      skuId: f.sku.id,
      fromBinId: f.shelfA.id,
      toBinId: f.shelfB.id,
      quantity: 3,
    });
    expect(result.level).toBeNull();
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it('to damaged takes units out of on hand', async () => {
    await stockShelf(4);
    const result = await move(prisma, {
      skuId: f.sku.id,
      fromBinId: f.shelfA.id,
      toBinId: f.damaged.id,
      quantity: 1,
      reason: 'damaged',
    });
    expect(result.level).toEqual({ onHand: 3, reserved: 0 });
  });

  it('cannot move units that orders have reserved off the shelf', async () => {
    await stockShelf(2);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    await expectStockError(
      move(prisma, { skuId: f.sku.id, fromBinId: f.shelfA.id, toBinId: f.damaged.id, quantity: 1 }),
      'would_break_reservations',
    );
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(2);
  });

  it('cannot move more than the bin holds, or between stores, or to the same bin', async () => {
    await stockShelf(1);
    await expectStockError(
      move(prisma, { skuId: f.sku.id, fromBinId: f.shelfA.id, toBinId: f.shelfB.id, quantity: 2 }),
      'insufficient_bin_stock',
    );
    await expectStockError(
      move(prisma, {
        skuId: f.sku.id,
        fromBinId: f.shelfA.id,
        toBinId: f.otherShelf.id,
        quantity: 1,
      }),
      'bin_wrong_store',
    );
    await expectStockError(
      move(prisma, { skuId: f.sku.id, fromBinId: f.shelfA.id, toBinId: f.shelfA.id, quantity: 1 }),
      'same_bin',
    );
  });
});

describe('reserve and release', () => {
  it('reserves within what is available', async () => {
    await stockShelf(3);
    const result = await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    expect(result.level).toEqual({ onHand: 3, reserved: 2 });
  });

  it('refuses to reserve more than is available and writes nothing', async () => {
    await stockShelf(3);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    await expectStockError(
      reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 }),
      'insufficient_stock',
    );
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 3, reserved: 2 });
    expect(await prisma.stockMovement.count({ where: { type: 'reserve' } })).toBe(1);
  });

  it('refuses to reserve a SKU the store never had', async () => {
    await expectStockError(
      reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku2.id, quantity: 1 }),
      'insufficient_stock',
    );
  });

  it('releases a reservation, but never more than was reserved', async () => {
    await stockShelf(3);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    const result = await release(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    expect(result.level).toEqual({ onHand: 3, reserved: 0 });
    await expectStockError(
      release(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 1 }),
      'insufficient_reserved',
    );
  });

  it('only one of many concurrent orders gets the last unit', async () => {
    await stockShelf(1);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 1 }),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 1, reserved: 1 });
  });
});

describe('pick', () => {
  it('takes reserved units off the shelf', async () => {
    await stockShelf(5);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    const result = await pick(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 2 });
    expect(result.level).toEqual({ onHand: 3, reserved: 0 });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(3);
  });

  it('cannot pick units that were not reserved', async () => {
    await stockShelf(5);
    await expectStockError(
      pick(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 1 }),
      'insufficient_reserved',
    );
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(5);
  });

  it('cannot pick from an empty bin or a non pickable bin', async () => {
    await stockShelf(2);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    await expectStockError(
      pick(prisma, { skuId: f.sku.id, binId: f.shelfB.id, quantity: 1 }),
      'insufficient_bin_stock',
    );
    await expectStockError(
      pick(prisma, { skuId: f.sku.id, binId: f.damaged.id, quantity: 1 }),
      'bin_not_pickable',
    );
  });
});

describe('adjust', () => {
  it('adds and removes units after a count', async () => {
    await stockShelf(5);
    expect(
      (await adjust(prisma, { skuId: f.sku.id, binId: f.shelfA.id, delta: 2, reason: 'count' }))
        .level,
    ).toEqual({
      onHand: 7,
      reserved: 0,
    });
    expect(
      (await adjust(prisma, { skuId: f.sku.id, binId: f.shelfA.id, delta: -4, reason: 'count' }))
        .level,
    ).toEqual({
      onHand: 3,
      reserved: 0,
    });
  });

  it('never goes below zero', async () => {
    await stockShelf(2);
    await expectStockError(
      adjust(prisma, { skuId: f.sku.id, binId: f.shelfA.id, delta: -3, reason: 'count' }),
      'insufficient_bin_stock',
    );
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 2, reserved: 0 });
  });

  it('cannot remove units that orders have reserved', async () => {
    await stockShelf(3);
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 2 });
    await expectStockError(
      adjust(prisma, { skuId: f.sku.id, binId: f.shelfA.id, delta: -2, reason: 'count' }),
      'would_break_reservations',
    );
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(3);
  });

  it('refuses a zero delta', async () => {
    await expectStockError(
      adjust(prisma, { skuId: f.sku.id, binId: f.shelfA.id, delta: 0, reason: 'count' }),
      'invalid_quantity',
    );
  });
});

describe('idempotency', () => {
  it('applies a movement once however many times it is retried', async () => {
    const input = { skuId: f.sku.id, binId: f.shelfA.id, quantity: 4, idempotencyKey: 'job-42' };
    const first = await receive(prisma, input);
    const second = await receive(prisma, input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.movement.id).toBe(first.movement.id);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 4, reserved: 0 });
  });

  it('applies once when the same key arrives at the same time', async () => {
    const input = { skuId: f.sku.id, binId: f.shelfA.id, quantity: 4, idempotencyKey: 'job-43' };
    const results = await Promise.all([
      receive(prisma, input),
      receive(prisma, input),
      receive(prisma, input),
    ]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 4, reserved: 0 });
  });
});

describe('audit and transactions', () => {
  it('writes one audit row per movement with before and after', async () => {
    await stockShelf(5);
    await reserve(prisma, {
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 2,
      actorUserId: null,
    });
    const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => e.action)).toEqual(['stock.receive', 'stock.reserve']);
    expect(entries[1]!.before).toEqual({ onHand: 5, reserved: 0 });
    expect(entries[1]!.after).toMatchObject({ onHand: 5, reserved: 2 });
    expect(entries[0]!.before).toMatchObject({ bins: { 'A-01': 0 } });
    expect(entries[0]!.after).toMatchObject({ bins: { 'A-01': 5 } });
  });

  it('rolls back everything when a later step fails', async () => {
    await stockShelf(2);
    await expect(
      prisma.$transaction(async (tx) => {
        await reserve(tx, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 1 });
        await reserve(tx, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 5 });
      }),
    ).rejects.toMatchObject({ code: 'insufficient_stock' });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 2, reserved: 0 });
    expect(await prisma.stockMovement.count({ where: { type: 'reserve' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'stock.reserve' } })).toBe(0);
  });
});
