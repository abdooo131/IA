import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approveCount, rejectCount, submitCount } from '../src/counts';
import { cancelManifest, closeManifest, createManifest, receiveOnManifest } from '../src/inbound';
import { reserve, receive } from '../src/stock';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let actor: string;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  actor = (
    await prisma.user.create({
      data: { email: 'a@test.eg', name: 'A', role: 'admin', passwordHash: 'x' },
    })
  ).id;
});

afterAll(() => prisma.$disconnect());

const newManifest = (lines = [{ skuId: f.sku.id, expectedQty: 10 }]) =>
  createManifest(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    reference: `REF-${Math.random()}`,
    lines,
    actorUserId: actor,
  });

describe('inbound manifests', () => {
  it('receives scans into the receiving bin and counts them on the line', async () => {
    const m = await newManifest();
    for (let i = 0; i < 10; i++) {
      await receiveOnManifest(prisma, {
        manifestId: m.id,
        darkStoreId: f.store.id,
        skuId: f.sku.id,
        quantity: 1,
        actorUserId: actor,
        idempotencyKey: `scan-${i}`,
      });
    }
    expect(await binQty(f.receiving.id, f.sku.id)).toBe(10);
    // Receiving is not sellable until put away.
    expect(await level(f.store.id, f.sku.id)).toBeNull();
    const line = await prisma.inboundManifestLine.findFirstOrThrow({ where: { manifestId: m.id } });
    expect(line.receivedQty).toBe(10);
    expect((await prisma.inboundManifest.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      'receiving',
    );
  });

  it('counts a repeated scan once', async () => {
    const m = await newManifest();
    const scan = {
      manifestId: m.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 2,
      actorUserId: actor,
      idempotencyKey: 'scan-same',
    };
    await receiveOnManifest(prisma, scan);
    const again = await receiveOnManifest(prisma, scan);
    expect(again.replayed).toBe(true);
    expect(await binQty(f.receiving.id, f.sku.id)).toBe(2);
    expect(
      (await prisma.inboundManifestLine.findFirstOrThrow({ where: { manifestId: m.id } }))
        .receivedQty,
    ).toBe(2);
  });

  it('records extra products that were not on the manifest', async () => {
    const m = await newManifest();
    await receiveOnManifest(prisma, {
      manifestId: m.id,
      darkStoreId: f.store.id,
      skuId: f.sku2.id,
      quantity: 3,
      actorUserId: actor,
      idempotencyKey: 'extra',
    });
    const extra = await prisma.inboundManifestLine.findFirstOrThrow({
      where: { manifestId: m.id, skuId: f.sku2.id },
    });
    expect(extra).toMatchObject({ expectedQty: 0, receivedQty: 3 });
  });

  it('closes with a summary for the merchant and refuses scans afterwards', async () => {
    const m = await newManifest();
    await receiveOnManifest(prisma, {
      manifestId: m.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 7,
      actorUserId: actor,
      idempotencyKey: 'k1',
    });
    const { lines } = await closeManifest(prisma, {
      manifestId: m.id,
      darkStoreId: f.store.id,
      actorUserId: actor,
    });
    expect(lines).toEqual([expect.objectContaining({ expectedQty: 10, receivedQty: 7 })]);
    const note = await prisma.notification.findFirstOrThrow();
    expect(note).toMatchObject({ merchantId: f.merchant.id, type: 'manifest_received' });
    await expect(
      receiveOnManifest(prisma, {
        manifestId: m.id,
        darkStoreId: f.store.id,
        skuId: f.sku.id,
        quantity: 1,
        actorUserId: actor,
        idempotencyKey: 'late',
      }),
    ).rejects.toMatchObject({ code: 'manifest_closed' });
  });

  it('refuses another store, unknown products and duplicate references', async () => {
    const m = await newManifest();
    await expect(
      receiveOnManifest(prisma, {
        manifestId: m.id,
        darkStoreId: f.other.id,
        skuId: f.sku.id,
        quantity: 1,
        actorUserId: actor,
        idempotencyKey: 'x',
      }),
    ).rejects.toMatchObject({ code: 'manifest_not_found' });
    await expect(
      createManifest(prisma, {
        merchantId: f.merchant.id,
        darkStoreId: f.store.id,
        reference: m.reference,
        lines: [{ skuId: f.sku.id, expectedQty: 1 }],
        actorUserId: actor,
      }),
    ).rejects.toMatchObject({ code: 'reference_taken' });
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    await expect(
      createManifest(prisma, {
        merchantId: other.id,
        darkStoreId: f.store.id,
        reference: 'R',
        lines: [{ skuId: f.sku.id, expectedQty: 1 }],
        actorUserId: actor,
      }),
    ).rejects.toMatchObject({ code: 'sku_not_found' });
  });

  it('can be cancelled only before receiving starts', async () => {
    const m = await newManifest();
    await cancelManifest(prisma, {
      manifestId: m.id,
      merchantId: f.merchant.id,
      actorUserId: actor,
    });
    await expect(
      cancelManifest(prisma, { manifestId: m.id, merchantId: f.merchant.id, actorUserId: actor }),
    ).rejects.toMatchObject({ code: 'manifest_not_cancellable' });
  });
});

describe('stock counts', () => {
  beforeEach(async () => {
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 10 });
    await receive(prisma, { skuId: f.sku2.id, binId: f.shelfA.id, quantity: 4 });
  });

  it('does not change stock until approved, then adjusts and notifies the merchant', async () => {
    const count = await submitCount(prisma, {
      darkStoreId: f.store.id,
      binId: f.shelfA.id,
      lines: [{ skuId: f.sku.id, countedQty: 8 }],
      actorUserId: actor,
    });
    // SKU-2 was not counted, so it counts as 0.
    expect(count.variances).toBe(2);
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(10);

    const result = await approveCount(prisma, { countId: count.id, actorUserId: actor });
    expect(result).toEqual({ status: 'approved', adjusted: 2 });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(8);
    expect(await binQty(f.shelfA.id, f.sku2.id)).toBe(0);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 8, reserved: 0 });

    const note = await prisma.notification.findFirstOrThrow({
      where: { type: 'stock_count_adjusted' },
    });
    expect((note.data as { lines: unknown[] }).lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ sku: 'SKU-1', before: 10, after: 8 })]),
    );
    await expect(
      approveCount(prisma, { countId: count.id, actorUserId: actor }),
    ).rejects.toMatchObject({
      code: 'count_already_reviewed',
    });
  });

  it('marks the count stale when the bin changed before approval', async () => {
    const count = await submitCount(prisma, {
      darkStoreId: f.store.id,
      binId: f.shelfA.id,
      lines: [
        { skuId: f.sku.id, countedQty: 9 },
        { skuId: f.sku2.id, countedQty: 4 },
      ],
      actorUserId: actor,
    });
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 1 });
    expect(await approveCount(prisma, { countId: count.id, actorUserId: actor })).toEqual({
      status: 'stale',
      adjusted: 0,
    });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(11);
  });

  it('cannot count away units that orders reserved', async () => {
    await reserve(prisma, { darkStoreId: f.store.id, skuId: f.sku.id, quantity: 9 });
    const count = await submitCount(prisma, {
      darkStoreId: f.store.id,
      binId: f.shelfA.id,
      lines: [
        { skuId: f.sku.id, countedQty: 5 },
        { skuId: f.sku2.id, countedQty: 4 },
      ],
      actorUserId: actor,
    });
    await expect(
      approveCount(prisma, { countId: count.id, actorUserId: actor }),
    ).rejects.toMatchObject({
      code: 'would_break_reservations',
    });
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } })).status).toBe(
      'submitted',
    );
  });

  it('can be rejected without touching stock', async () => {
    const count = await submitCount(prisma, {
      darkStoreId: f.store.id,
      binId: f.shelfA.id,
      lines: [{ skuId: f.sku.id, countedQty: 1 }],
      actorUserId: actor,
    });
    await rejectCount(prisma, { countId: count.id, actorUserId: actor, note: 'recount' });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(10);
    expect(await prisma.notification.count()).toBe(0);
  });
});
