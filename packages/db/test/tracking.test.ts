import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  handToRider,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { savePhoto } from '../src/photos';
import { receive } from '../src/stock';
import { getTracking, getTrackingPhoto, rateOrder, recordRiderLocation } from '../src/tracking';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let staff: string;
let riderUser: string;
let n = 0;
const key = () => `t-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  staff = (
    await prisma.user.create({
      data: { email: 's@t.eg', name: 'Staff', role: 'store_staff', passwordHash: 'x' },
    })
  ).id;
  riderUser = (
    await prisma.user.create({
      data: {
        email: 'r@t.eg',
        name: 'Omar Hassan',
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
});

afterAll(() => prisma.$disconnect());

async function orderOnTheRoad() {
  const created = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Sara',
    customerPhone: '01012345678',
    addressText: '12 Road 9, Maadi',
    latitude: 29.96,
    longitude: 31.25,
    paymentMethod: 'cod',
    deliveryFeePiastres: 2000,
    items: [{ skuId: f.sku.id, quantity: 1 }],
    actorUserId: staff,
  });
  const id = created.id;
  await acceptOrder(prisma, { orderId: id, darkStoreId: f.store.id, actorUserId: staff });
  await pickOrderItem(prisma, {
    orderId: id,
    darkStoreId: f.store.id,
    skuId: f.sku.id,
    quantity: 1,
    actorUserId: staff,
    idempotencyKey: key(),
  });
  const pack = await savePhoto(prisma, {
    kind: 'pack',
    contentType: 'image/jpeg',
    data: Buffer.from('jpeg'),
    actorUserId: staff,
  });
  await packOrder(prisma, {
    orderId: id,
    darkStoreId: f.store.id,
    photoId: pack.id,
    actorUserId: staff,
  });
  await handToRider(prisma, {
    orderId: id,
    darkStoreId: f.store.id,
    badgeCode: 'RDR-1',
    actorUserId: staff,
  });
  return prisma.order.findUniqueOrThrow({ where: { id } });
}

async function deliver(orderId: string) {
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
  const photo = await savePhoto(prisma, {
    kind: 'delivery',
    contentType: 'image/jpeg',
    data: Buffer.from('door'),
    actorUserId: riderUser,
  });
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  await completeDelivery(prisma, {
    deliveryId: delivery.id,
    riderUserId: riderUser,
    photoId: photo.id,
    codCollectedPiastres: o.codAmountPiastres,
  });
}

describe('customer tracking', () => {
  it('gives every order its own unguessable token', async () => {
    const a = await orderOnTheRoad();
    expect(a.trackingToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('shows the delivery code and the rider on the road, never the address', async () => {
    const o = await orderOnTheRoad();
    const view = await getTracking(prisma, o.trackingToken);
    expect(view).toMatchObject({
      number: o.number,
      status: 'out_for_delivery',
      deliveryCode: o.deliveryOtp,
      riderName: 'Omar',
      riderPosition: null,
      canRate: false,
    });
    expect(JSON.stringify(view)).not.toContain('Road 9');
    expect(JSON.stringify(view)).not.toContain('1012345678');
  });

  it('shows the rider position only while fresh', async () => {
    const o = await orderOnTheRoad();
    const t0 = new Date();
    expect(
      await recordRiderLocation(prisma, {
        riderUserId: riderUser,
        lat: 29.97,
        lng: 31.26,
        now: t0,
      }),
    ).toEqual({ stored: true });
    let view = await getTracking(prisma, o.trackingToken, new Date(t0.getTime() + 60_000));
    expect(view.riderPosition).toMatchObject({ lat: 29.97, lng: 31.26 });
    expect(view.destination).toEqual({ lat: 29.96, lng: 31.25 });
    view = await getTracking(prisma, o.trackingToken, new Date(t0.getTime() + 6 * 60_000));
    expect(view.riderPosition).toBeNull();
    expect(view.destination).toBeNull();
  });

  it('does not store a position for a rider who carries nothing', async () => {
    expect(await recordRiderLocation(prisma, { riderUserId: riderUser, lat: 1, lng: 1 })).toEqual({
      stored: false,
    });
  });

  it('after delivery hides the code, shows the photo and takes one rating', async () => {
    const o = await orderOnTheRoad();
    await expect(rateOrder(prisma, { token: o.trackingToken, stars: 5 })).rejects.toMatchObject({
      code: 'not_delivered',
    });
    await deliver(o.id);
    const view = await getTracking(prisma, o.trackingToken);
    expect(view).toMatchObject({
      status: 'delivered',
      deliveryCode: null,
      hasProofPhoto: true,
      canRate: true,
    });
    expect(Buffer.from((await getTrackingPhoto(prisma, o.trackingToken)).data).toString()).toBe(
      'door',
    );

    await rateOrder(prisma, { token: o.trackingToken, stars: 2, comment: ' late ' });
    await expect(rateOrder(prisma, { token: o.trackingToken, stars: 5 })).rejects.toMatchObject({
      code: 'already_rated',
    });
    expect(await getTracking(prisma, o.trackingToken)).toMatchObject({
      rating: { stars: 2, comment: 'late' },
      canRate: false,
    });
    const alert = await prisma.alert.findFirstOrThrow({ where: { orderId: o.id } });
    expect(alert.type).toBe('low_rating');
  });

  it('answers not found for unknown or malformed tokens', async () => {
    await expect(getTracking(prisma, 'x'.repeat(24))).rejects.toMatchObject({ code: 'not_found' });
    await expect(getTracking(prisma, '../etc')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses stars outside 1 to 5 at the database', async () => {
    const o = await orderOnTheRoad();
    await deliver(o.id);
    await expect(
      prisma.orderRating.create({ data: { orderId: o.id, stars: 6 } }),
    ).rejects.toThrow();
  });
});
