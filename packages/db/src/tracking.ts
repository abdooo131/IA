import type { OrderStatus } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { getSetting } from './settings';

// The customer's public tracking page (/t/<token>). It shows only what the customer already
// knows or needs: never the address, the phone or anything about other orders.

/** States in which the customer still needs the delivery code. */
const CODE_VISIBLE: OrderStatus[] = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
  'attempt_failed',
];

export interface TrackingView {
  number: string;
  merchantName: string;
  storeNameEn: string;
  storeNameAr: string;
  status: OrderStatus;
  placedAt: string;
  promiseAt: string | null;
  acceptedAt: string | null;
  packedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  paymentMethod: 'prepaid' | 'cod';
  codAmountPiastres: number;
  deliveryCode: string | null;
  riderName: string | null;
  /** Shown only while the order is on the road and the phone reported recently */
  riderPosition: { lat: number; lng: number; at: string } | null;
  destination: { lat: number; lng: number } | null;
  refreshSeconds: number;
  hasProofPhoto: boolean;
  rating: { stars: number; comment: string | null } | null;
  canRate: boolean;
}

async function findByToken(db: Db, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new DomainError('not_found', 404);
  const order = await db.order.findUnique({
    where: { trackingToken: token },
    include: {
      merchant: { select: { name: true } },
      darkStore: { select: { nameEn: true, nameAr: true } },
      rating: true,
      deliveries: {
        orderBy: { assignedAt: 'desc' },
        take: 1,
        include: { rider: { include: { user: { select: { name: true } } } } },
      },
    },
  });
  if (!order) throw new DomainError('not_found', 404);
  return order;
}

export async function getTracking(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<TrackingView> {
  const order = await findByToken(db, token);
  const delivery = order.deliveries[0];
  const onRoad = order.status === 'out_for_delivery' && delivery?.status === 'picked_up';
  const rider = onRoad ? delivery.rider : null;
  const staleMinutes = await getSetting(db, 'tracking.rider_stale_minutes', order.darkStoreId);
  const fresh =
    rider?.lastLocationAt &&
    rider.lastLat !== null &&
    rider.lastLng !== null &&
    now.getTime() - rider.lastLocationAt.getTime() <= staleMinutes * 60_000;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    number: order.number,
    merchantName: order.merchant.name,
    storeNameEn: order.darkStore.nameEn,
    storeNameAr: order.darkStore.nameAr,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    promiseAt: iso(order.slaDueAt),
    acceptedAt: iso(order.acceptedAt),
    packedAt: iso(order.packedAt),
    outForDeliveryAt: iso(order.outForDeliveryAt),
    deliveredAt: iso(order.deliveredAt),
    paymentMethod: order.paymentMethod,
    codAmountPiastres: order.codAmountPiastres,
    deliveryCode: CODE_VISIBLE.includes(order.status) ? order.deliveryOtp : null,
    // First name only: enough to recognise the rider at the door.
    riderName: rider ? (rider.user.name.split(' ')[0] ?? null) : null,
    riderPosition: fresh
      ? { lat: rider.lastLat!, lng: rider.lastLng!, at: rider.lastLocationAt!.toISOString() }
      : null,
    destination:
      fresh && order.latitude !== null && order.longitude !== null
        ? { lat: order.latitude, lng: order.longitude }
        : null,
    refreshSeconds: onRoad ? 15 : 60,
    hasProofPhoto: order.status === 'delivered' && Boolean(delivery?.proofPhotoId),
    rating: order.rating ? { stars: order.rating.stars, comment: order.rating.comment } : null,
    canRate: order.status === 'delivered' && !order.rating,
  };
}

/** The handover photo of a delivered order, for its tracking page. */
export async function getTrackingPhoto(db: Db, token: string) {
  const order = await findByToken(db, token);
  const photoId = order.status === 'delivered' ? order.deliveries[0]?.proofPhotoId : null;
  if (!photoId) throw new DomainError('not_found', 404);
  return db.photo.findUniqueOrThrow({
    where: { id: photoId },
    select: { contentType: true, data: true },
  });
}

/**
 * Stores the rider's latest position. Only kept while they carry an order, so riders are not
 * followed off duty; answers whether it was stored.
 */
export async function recordRiderLocation(
  db: Db,
  input: { riderUserId: string; lat: number; lng: number; now?: Date },
) {
  const rider = await db.rider.findUnique({ where: { userId: input.riderUserId } });
  if (!rider) throw new DomainError('rider_not_found', 404);
  const carrying = await db.delivery.count({
    where: { riderId: rider.id, status: 'picked_up' },
  });
  if (carrying === 0) return { stored: false };
  await db.rider.update({
    where: { id: rider.id },
    data: { lastLat: input.lat, lastLng: input.lng, lastLocationAt: input.now ?? new Date() },
  });
  return { stored: true };
}

/** The customer rates a delivered order once. Low ratings raise an admin alert. */
export function rateOrder(
  db: Db,
  input: { token: string; stars: number; comment?: string | null },
) {
  return inTransaction(db, async (tx) => {
    const order = await findByToken(tx, input.token);
    if (order.status !== 'delivered') throw new DomainError('not_delivered');
    // Two taps at once: the second waits for the first and then sees its rating.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id} FOR UPDATE`;
    if (await tx.orderRating.findUnique({ where: { orderId: order.id } }))
      throw new DomainError('already_rated');
    const comment = input.comment?.trim() || null;
    const rating = await tx.orderRating.create({
      data: { orderId: order.id, stars: input.stars, comment },
    });
    const threshold = await getSetting(tx, 'tracking.low_rating_stars');
    if (input.stars <= threshold) {
      await tx.alert.create({
        data: {
          type: 'low_rating',
          darkStoreId: order.darkStoreId,
          orderId: order.id,
          data: { stars: input.stars, comment },
        },
      });
    }
    await recordAudit(tx, {
      actorUserId: null,
      action: 'order.rated',
      entityType: 'order',
      entityId: order.id,
      after: { stars: input.stars, comment },
    });
    return { stars: rating.stars };
  });
}
