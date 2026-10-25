import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptOrder,
  cancelOrder,
  completeDelivery,
  createOrder,
  failDelivery,
  flagLateOrders,
  handToRider,
  markItemMissing,
  packOrder,
  pickOrderItem,
  returnToStore,
} from '../src/orders';
import { savePhoto } from '../src/photos';
import { setSetting } from '../src/settings';
import { receive } from '../src/stock';
import { binQty, createFixture, level, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let staff: string;
let riderUser: string;
let n = 0;
const key = () => `k-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  await prisma.bin.create({ data: { darkStoreId: f.store.id, code: 'HLD', type: 'held' } });
  staff = (
    await prisma.user.create({
      data: { email: 's@t.eg', name: 'Staff', role: 'store_staff', passwordHash: 'x' },
    })
  ).id;
  riderUser = (
    await prisma.user.create({
      data: {
        email: 'r@t.eg',
        name: 'Rider One',
        role: 'rider',
        passwordHash: 'x',
        darkStoreId: f.store.id,
      },
    })
  ).id;
  await prisma.rider.create({
    data: { userId: riderUser, darkStoreId: f.store.id, badgeCode: 'RDR-1' },
  });
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
  await receive(prisma, { skuId: f.sku2.id, binId: f.shelfB.id, quantity: 2 });
});

afterAll(() => prisma.$disconnect());

const order = (
  items: { skuId: string; quantity: number }[],
  extra: Partial<Parameters<typeof createOrder>[1]> = {},
) =>
  createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Sara',
    customerPhone: '01012345678',
    addressText: '12 Road 9, Maadi',
    paymentMethod: 'cod',
    deliveryFeePiastres: 2000,
    items,
    actorUserId: staff,
    ...extra,
  });

const at = { darkStoreId: () => f.store.id };
async function pickAll(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  for (const i of o.items) {
    const left = i.quantity - i.pickedQty - i.cancelledQty;
    if (left > 0)
      await pickOrderItem(prisma, {
        orderId,
        darkStoreId: at.darkStoreId(),
        skuId: i.skuId,
        quantity: left,
        actorUserId: staff,
        idempotencyKey: key(),
      });
  }
}
const packPhoto = async () =>
  (
    await savePhoto(prisma, {
      kind: 'pack',
      contentType: 'image/jpeg',
      data: Buffer.from('jpeg'),
      actorUserId: staff,
    })
  ).id;

describe('order intake', () => {
  it('reserves stock, numbers the order and computes COD in piastres', async () => {
    const created = await order([{ skuId: f.sku.id, quantity: 2 }]);
    expect(created).toMatchObject({ status: 'new', cancelled: [], phoneFlagged: false });
    expect(created.number).toMatch(/^SN\d+$/);
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 5, reserved: 2 });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(o).toMatchObject({
      subtotalPiastres: 2000,
      codAmountPiastres: 4000,
      customerPhone: '+201012345678',
    });
    expect(o.deliveryOtp).toMatch(/^\d{4}$/);
    expect(o.slaDueAt!.getTime() - o.placedAt.getTime()).toBe(60 * 60_000);
  });

  it('accepts what is in stock and cancels the rest, lowering COD', async () => {
    const created = await order([{ skuId: f.sku2.id, quantity: 5 }], { codAmountPiastres: 7000 });
    expect(created.cancelled).toEqual([{ sku: 'SKU-2', quantity: 3 }]);
    const o = await prisma.order.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
    expect(o.items[0]).toMatchObject({ quantity: 5, cancelledQty: 3 });
    // Shopify said 7000 owed; 3 units at 1000 were cancelled.
    expect(o.codAmountPiastres).toBe(4000);
    expect(await prisma.notification.count({ where: { type: 'order_items_cancelled' } })).toBe(1);
  });

  it('moves to standard when nothing is in stock, reserving nothing', async () => {
    const other = await prisma.sku.create({
      data: {
        merchantId: f.merchant.id,
        sku: 'SKU-3',
        titleEn: 'x',
        titleAr: 'x',
        pricePiastres: 500,
      },
    });
    const created = await order([{ skuId: other.id, quantity: 1 }]);
    expect(created.status).toBe('moved_to_standard');
    const o = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    expect(o).toMatchObject({ closedReason: 'no_stock', codAmountPiastres: 0 });
    expect(await prisma.stockMovement.count({ where: { type: 'reserve' } })).toBe(0);
  });

  it('accepts a non Egyptian phone but flags it for staff', async () => {
    const created = await order([{ skuId: f.sku.id, quantity: 1 }], {
      customerPhone: '+44 20 7946 0000',
    });
    expect(created.phoneFlagged).toBe(true);
    expect(
      await prisma.alert.count({ where: { type: 'phone_invalid', orderId: created.id } }),
    ).toBe(1);
  });

  it('gives the last unit to only one of two racing orders', async () => {
    const results = await Promise.all([
      order([{ skuId: f.sku2.id, quantity: 2 }]),
      order([{ skuId: f.sku2.id, quantity: 2 }]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['moved_to_standard', 'new']);
    expect(await level(f.store.id, f.sku2.id)).toEqual({ onHand: 2, reserved: 2 });
  });

  it('refuses products of another merchant', async () => {
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    await expect(
      order([{ skuId: f.sku.id, quantity: 1 }], { merchantId: other.id }),
    ).rejects.toMatchObject({ code: 'sku_not_found' });
  });
});

describe('order flow', () => {
  it('goes from new to delivered, moving stock and recording every step', async () => {
    const { id } = await order([
      { skuId: f.sku.id, quantity: 2 },
      { skuId: f.sku2.id, quantity: 1 },
    ]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await pickAll(id);
    let o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o.status).toBe('picking');
    expect(o.pickedAt).not.toBeNull();
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 3, reserved: 0 });
    expect(await binQty(f.shelfA.id, f.sku.id)).toBe(3);

    await packOrder(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      actorUserId: staff,
    });
    const handed = await handToRider(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    expect(handed).toMatchObject({ rider: 'Rider One', batched: false });

    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: id } });
    o = await prisma.order.findUniqueOrThrow({ where: { id } });
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId: riderUser,
      otp: o.deliveryOtp,
      codCollectedPiastres: o.codAmountPiastres,
    });
    o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o.status).toBe('delivered');
    const events = await prisma.orderEvent.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual([
      'created',
      'accepted',
      'picking_started',
      'item_picked',
      'item_picked',
      'picking_done',
      'packed',
      'handed_to_rider',
      'delivered',
    ]);
    expect(await prisma.alert.count({ where: { type: 'cod_mismatch' } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'order_delivered' } })).toBe(1);
  });

  it('applies a repeated pick scan once and refuses picking too many', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 2 }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    const k = key();
    await pickOrderItem(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: k,
    });
    const again = await pickOrderItem(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: k,
    });
    expect(again.replayed).toBe(true);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: id } })).pickedQty).toBe(1);
    await expect(
      pickOrderItem(prisma, {
        orderId: id,
        darkStoreId: f.store.id,
        skuId: f.sku.id,
        quantity: 2,
        actorUserId: staff,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'over_pick' });
  });

  it('cancels a missing item, alerts admin, and keeps going with the rest', async () => {
    const { id } = await order([
      { skuId: f.sku.id, quantity: 2 },
      { skuId: f.sku2.id, quantity: 1 },
    ]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await markItemMissing(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku2.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: key(),
    });
    expect(await level(f.store.id, f.sku2.id)).toEqual({ onHand: 2, reserved: 0 });
    await pickAll(id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o.status).toBe('picking');
    expect(o.pickedAt).not.toBeNull();
    expect(o.codAmountPiastres).toBe(2000 + 2000);
    expect(await prisma.alert.count({ where: { type: 'item_missing', orderId: id } })).toBe(1);
  });

  it('moves to standard when every item is missing', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 1 }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await markItemMissing(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: key(),
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe(
      'moved_to_standard',
    );
  });

  it('refuses to pack before picking is done or without a pack photo', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 2 }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await pickOrderItem(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: key(),
    });
    await expect(
      packOrder(prisma, {
        orderId: id,
        darkStoreId: f.store.id,
        photoId: await packPhoto(),
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'not_fully_picked',
    });
    await pickAll(id);
    const wrong = await savePhoto(prisma, {
      kind: 'delivery',
      contentType: 'image/jpeg',
      data: Buffer.from('x'),
      actorUserId: staff,
    });
    await expect(
      packOrder(prisma, {
        orderId: id,
        darkStoreId: f.store.id,
        photoId: wrong.id,
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'photo_required',
    });
  });

  it('refuses a status jump and another store', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 1 }]);
    await expect(
      packOrder(prisma, {
        orderId: id,
        darkStoreId: f.store.id,
        photoId: await packPhoto(),
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'not_fully_picked',
    });
    await expect(
      acceptOrder(prisma, { orderId: id, darkStoreId: f.other.id, actorUserId: staff }),
    ).rejects.toMatchObject({ code: 'order_not_found' });
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await expect(
      acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff }),
    ).rejects.toMatchObject({
      code: 'invalid_order_state',
    });
  });
});

describe('hand over and batching', () => {
  async function packed(qty = 1) {
    const { id } = await order([{ skuId: f.sku.id, quantity: qty }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await pickAll(id);
    await packOrder(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      actorUserId: staff,
    });
    return id;
  }

  it('batches two orders into one trip, then refuses a third', async () => {
    const a = await packed();
    const b = await packed();
    const c = await packed();
    const first = await handToRider(prisma, {
      orderId: a,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    const second = await handToRider(prisma, {
      orderId: b,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    expect(second).toMatchObject({ batched: true, tripId: first.tripId });
    await expect(
      handToRider(prisma, {
        orderId: c,
        darkStoreId: f.store.id,
        badgeCode: 'RDR-1',
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'rider_full',
    });
  });

  it('will not batch when an order in the trip is past its promise', async () => {
    const a = await packed();
    const b = await packed();
    await handToRider(prisma, {
      orderId: a,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    await expect(
      handToRider(prisma, {
        orderId: b,
        darkStoreId: f.store.id,
        badgeCode: 'RDR-1',
        actorUserId: staff,
        now: new Date(Date.now() + 2 * 3600_000),
      }),
    ).rejects.toMatchObject({ code: 'batch_would_break_sla' });
  });

  it('refuses unknown badges and riders of another store, and respects the trip setting', async () => {
    const a = await packed();
    await expect(
      handToRider(prisma, {
        orderId: a,
        darkStoreId: f.store.id,
        badgeCode: 'NOPE',
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'rider_not_found',
    });
    const otherUser = await prisma.user.create({
      data: { email: 'r2@t.eg', name: 'R2', role: 'rider', passwordHash: 'x' },
    });
    await prisma.rider.create({
      data: { userId: otherUser.id, darkStoreId: f.other.id, badgeCode: 'RDR-2' },
    });
    await expect(
      handToRider(prisma, {
        orderId: a,
        darkStoreId: f.store.id,
        badgeCode: 'RDR-2',
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'rider_other_store',
    });
    await setSetting(prisma, {
      key: 'delivery.max_orders_per_trip',
      value: 1,
      scope: f.store.id,
      actorUserId: null,
    });
    const b = await packed();
    await handToRider(prisma, {
      orderId: a,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    await expect(
      handToRider(prisma, {
        orderId: b,
        darkStoreId: f.store.id,
        badgeCode: 'RDR-1',
        actorUserId: staff,
      }),
    ).rejects.toMatchObject({
      code: 'rider_full',
    });
  });
});

describe('delivery', () => {
  async function outForDelivery() {
    const { id } = await order([{ skuId: f.sku.id, quantity: 2 }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await pickAll(id);
    await packOrder(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      photoId: await packPhoto(),
      actorUserId: staff,
    });
    await handToRider(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: staff,
    });
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: id } });
    return { id, delivery };
  }

  it('refuses a wrong code, needs the COD amount, and alerts on a cash difference', async () => {
    const { id, delivery } = await outForDelivery();
    const { deliveryOtp } = await prisma.order.findUniqueOrThrow({ where: { id } });
    const wrong = deliveryOtp === '0000' ? '1111' : '0000';
    await expect(
      completeDelivery(prisma, {
        deliveryId: delivery.id,
        riderUserId: riderUser,
        otp: wrong,
        codCollectedPiastres: 0,
      }),
    ).rejects.toMatchObject({ code: 'wrong_otp' });
    const photo = await savePhoto(prisma, {
      kind: 'delivery',
      contentType: 'image/jpeg',
      data: Buffer.from('d'),
      actorUserId: riderUser,
    });
    await expect(
      completeDelivery(prisma, {
        deliveryId: delivery.id,
        riderUserId: riderUser,
        photoId: photo.id,
      }),
    ).rejects.toMatchObject({
      code: 'cod_required',
    });
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId: riderUser,
      photoId: photo.id,
      codCollectedPiastres: 3000,
    });
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'cod_mismatch' } });
    expect(alert.data).toEqual({ expected: 4000, collected: 3000 });
  });

  it('only lets the assigned rider close the delivery', async () => {
    const { delivery } = await outForDelivery();
    await expect(
      completeDelivery(prisma, { deliveryId: delivery.id, riderUserId: staff, otp: '0000' }),
    ).rejects.toMatchObject({
      code: 'delivery_not_found',
    });
  });

  it('records a failed delivery and takes the goods back into the held bin once', async () => {
    const { id, delivery } = await outForDelivery();
    await failDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId: riderUser,
      reason: 'no_answer',
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('failed');
    const held = await prisma.bin.findFirstOrThrow({
      where: { darkStoreId: f.store.id, type: 'held' },
    });
    await returnToStore(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await returnToStore(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    expect(await binQty(held.id, f.sku.id)).toBe(2);
    expect(await prisma.alert.count({ where: { type: 'delivery_failed' } })).toBe(1);
  });
});

describe('cancel', () => {
  it('releases what was reserved and sends picked units to the held bin', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 3 }]);
    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await pickOrderItem(prisma, {
      orderId: id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 1,
      actorUserId: staff,
      idempotencyKey: key(),
    });
    await cancelOrder(prisma, { orderId: id, reason: 'customer_request', actorUserId: staff });
    expect(await level(f.store.id, f.sku.id)).toEqual({ onHand: 4, reserved: 0 });
    const held = await prisma.bin.findFirstOrThrow({
      where: { darkStoreId: f.store.id, type: 'held' },
    });
    expect(await binQty(held.id, f.sku.id)).toBe(1);
    await expect(
      cancelOrder(prisma, { orderId: id, reason: 'again', actorUserId: staff }),
    ).rejects.toMatchObject({ code: 'invalid_order_state' });
  });
});

describe('SLA check', () => {
  it('flags a late stage once, however often it runs, and moves the flag with the order', async () => {
    const { id } = await order([{ skuId: f.sku.id, quantity: 1 }], {
      placedAt: new Date(Date.now() - 5 * 60_000),
    });
    const first = await flagLateOrders(prisma);
    const second = await flagLateOrders(prisma);
    expect(first.flagged).toBe(1);
    expect(second.flagged).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).lateStage).toBe('accept');
    expect(await prisma.alert.count({ where: { type: 'late', orderId: id } })).toBe(1);

    await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
    await flagLateOrders(prisma);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).lateStage).toBeNull();
  });
});

describe('order views', () => {
  it('lists the active queue by promise time and shows full detail with names', async () => {
    const { listOrders, getOrderDetail } = await import('../src/order-views');
    const late = await order([{ skuId: f.sku.id, quantity: 1 }], {
      placedAt: new Date(Date.now() - 10 * 60_000),
    });
    const fresh = await order([{ skuId: f.sku2.id, quantity: 1 }]);
    const queue = await listOrders(
      prisma,
      { darkStoreId: f.store.id, statuses: ['new', 'accepted', 'picking', 'packed'] },
      'promise',
    );
    expect(queue.map((q) => q.id)).toEqual([late.id, fresh.id]);
    expect(queue[0]!.stage).toMatchObject({ stage: 'accept', late: true });

    await acceptOrder(prisma, { orderId: fresh.id, darkStoreId: f.store.id, actorUserId: staff });
    const detail = await getOrderDetail(prisma, fresh.id);
    expect(detail!.events.map((e) => [e.type, e.by])).toEqual([
      ['created', 'Staff'],
      ['accepted', 'Staff'],
    ]);
    expect(detail!.items[0]!.bins).toEqual([{ id: f.shelfB.id, code: 'A-02', quantity: 2 }]);
    expect(await listOrders(prisma, { q: fresh.number })).toHaveLength(1);
  });
});
