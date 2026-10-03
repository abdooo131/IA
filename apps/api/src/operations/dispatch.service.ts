import { BadRequestException, Injectable } from '@nestjs/common';
import { FAILED_ATTEMPT_REASONS, FailedAttemptReason, OrderStatus } from '@shiply/shared';
import { RequestContext } from '../common/context';
import { OrdersService } from '../orders/orders.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AlertsService } from './alerts.service';
import { DriversService } from './drivers.service';

export interface BulkResult {
  ok: { id: string; trackingNumber: string; status: string }[];
  failed: { id: string; trackingNumber?: string; error: string }[];
}

export const FAILED_REASON_TEXT: Record<FailedAttemptReason, string> = {
  CUSTOMER_REFUSED: 'Customer refused to receive the order',
  WANTS_TO_OPEN_BEFORE_PAYING: 'Customer wants to open the order before paying',
  POSTPONE_REQUESTED: 'Customer requested to postpone to another day',
  NOT_ANSWERING_PHONE: 'Customer is not answering the phone',
  NOT_AT_ADDRESS: 'Customer is not at the address',
  ADDRESS_INCORRECT: 'Address is incorrect or incomplete',
  PHONE_INCORRECT: 'Phone number is not correct',
};

/**
 * Operations run from the web: assign drivers, confirm pickups, send out for delivery and record
 * results. Each order is processed in its own transaction so one problem never blocks the batch.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly drivers: DriversService,
    private readonly alerts: AlertsService,
  ) {}

  private async each(ctx: RequestContext, ids: string[], fn: (tx: Tx, id: string) => Promise<{ trackingNumber: string; status: string }>): Promise<BulkResult> {
    const result: BulkResult = { ok: [], failed: [] };
    for (const id of [...new Set(ids)]) {
      try {
        const r = await this.prisma.withContext(ctx, (tx) => fn(tx, id));
        result.ok.push({ id, ...r });
      } catch (e) {
        const tn = await this.prisma.withContext(ctx, (tx) => tx.order.findUnique({ where: { id }, select: { trackingNumber: true } })).catch(() => null);
        result.failed.push({ id, trackingNumber: tn?.trackingNumber, error: (e as Error).message });
      }
    }
    return result;
  }

  /** Pickup queue: orders waiting for collection, grouped by merchant pickup location. */
  async pickupQueue(ctx: RequestContext) {
    return this.prisma.withContext(ctx, async (tx) => {
      const orders = await tx.order.findMany({
        where: { status: { in: ['NEW', 'PENDING_PICKUP'] }, archived: false },
        select: {
          id: true, trackingNumber: true, status: true, codAmount: true, size: true, createdAt: true, pickupDriverId: true,
          merchant: { select: { id: true, nameEn: true, nameAr: true } },
          pickupLocation: { select: { id: true, name: true, area: true, addressLine: true, governorateCode: true, contactPhone: true } },
          pickupDriver: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const stops = new Map<string, { key: string; merchant: (typeof orders)[number]['merchant']; location: (typeof orders)[number]['pickupLocation']; orders: typeof orders }>();
      for (const o of orders) {
        const key = `${o.merchant.id}:${o.pickupLocation?.id ?? 'none'}`;
        if (!stops.has(key)) stops.set(key, { key, merchant: o.merchant, location: o.pickupLocation, orders: [] });
        stops.get(key)!.orders.push(o);
      }
      return [...stops.values()];
    });
  }

  /** Assigns a pickup driver; NEW orders are moved to Pending Pickup at the same time. */
  async assignPickup(ctx: RequestContext, ids: string[], driverId: string) {
    return this.each(ctx, ids, async (tx, id) => {
      const d = await this.drivers.requireActive(tx, driverId, 'PICKUP');
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (o.status === 'NEW') {
        await this.orders.transitionInTx(tx, ctx, id, 'PENDING_PICKUP', { data: { pickupDriverId: d.id }, note: `Pickup assigned to ${d.fullName}`, metadata: { pickupDriverId: d.id } });
      } else if (o.status === 'PENDING_PICKUP') {
        await tx.order.update({ where: { id }, data: { pickupDriverId: d.id } });
        await this.event(tx, ctx, o, 'PICKUP_ASSIGNED', `Pickup assigned to ${d.fullName}`, { pickupDriverId: d.id });
      } else throw new BadRequestException(`Order is ${o.status}, not waiting for pickup`);
      return { trackingNumber: o.trackingNumber, status: 'PENDING_PICKUP' };
    });
  }

  /** The pickup driver collected these parcels from the merchant. */
  async markPickedUp(ctx: RequestContext, ids: string[]) {
    return this.each(ctx, ids, async (tx, id) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id }, include: { pickupDriver: true } });
      if (o.status === 'NEW') await this.orders.transitionInTx(tx, ctx, id, 'PENDING_PICKUP');
      const r = await this.orders.transitionInTx(tx, ctx, id, 'PICKED_UP', {
        note: o.pickupDriver ? `Picked up by ${o.pickupDriver.fullName}` : 'Picked up',
        metadata: { pickupDriverId: o.pickupDriverId },
      });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Delivery queue for a last mile hub: parcels at the hub, assigned to drivers, or out for delivery. */
  async deliveryBoard(ctx: RequestContext, hubId?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const select = {
        id: true, trackingNumber: true, status: true, codAmount: true, customerName: true, customerPhone: true,
        area: true, addressLine: true, governorateCode: true, attempts: true, lastFailedReason: true, allowOpenPackage: true,
        deliveryDriverId: true, currentHubId: true, destinationHubId: true, type: true,
        merchant: { select: { nameEn: true, nameAr: true } },
        deliveryDriver: { select: { id: true, fullName: true } },
      } as const;
      const atHub = await tx.order.findMany({
        where: { status: 'AT_LAST_MILE_HUB', ...(hubId ? { currentHubId: hubId } : {}) },
        select,
        orderBy: { updatedAt: 'asc' },
      });
      const withDrivers = await tx.order.findMany({
        where: { status: { in: ['ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER'] }, ...(hubId ? { OR: [{ currentHubId: hubId }, { destinationHubId: hubId }] } : {}) },
        select,
        orderBy: { updatedAt: 'asc' },
      });
      const reattempts = await tx.order.findMany({
        where: { status: 'AWAITING_MERCHANT_ACTION', ...(hubId ? { OR: [{ currentHubId: hubId }, { destinationHubId: hubId }] } : {}) },
        select,
        orderBy: { updatedAt: 'asc' },
      });
      return { atHub, withDrivers, awaitingMerchant: reattempts };
    });
  }

  /** Hands parcels at the hub (or re-attempts) to a delivery driver. */
  async assignDelivery(ctx: RequestContext, ids: string[], driverId: string) {
    return this.each(ctx, ids, async (tx, id) => {
      const d = await this.drivers.requireActive(tx, driverId, 'DELIVERY');
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (o.status === 'ASSIGNED_TO_DRIVER') {
        await tx.order.update({ where: { id }, data: { deliveryDriverId: d.id } });
        await this.event(tx, ctx, o, 'DRIVER_REASSIGNED', `Reassigned to ${d.fullName}`, { deliveryDriverId: d.id });
        return { trackingNumber: o.trackingNumber, status: o.status };
      }
      if (!['AT_LAST_MILE_HUB', 'AWAITING_MERCHANT_ACTION', 'REJECTED_RETURN'].includes(o.status)) {
        throw new BadRequestException(`Order is ${o.status}; it must be at the last mile hub`);
      }
      const r = await this.orders.transitionInTx(tx, ctx, id, 'ASSIGNED_TO_DRIVER', {
        data: { deliveryDriverId: d.id },
        note: `Assigned to ${d.fullName}`,
        metadata: { deliveryDriverId: d.id },
      });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Driver left the hub with these parcels. */
  async outForDelivery(ctx: RequestContext, ids: string[]) {
    return this.each(ctx, ids, async (tx, id) => {
      const r = await this.orders.transitionInTx(tx, ctx, id, 'HEADING_TO_CUSTOMER', { note: 'Out for delivery' });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Delivered: COD is now with the driver (posted to the ledger against that driver). */
  async markDelivered(ctx: RequestContext, ids: string[], note?: string) {
    return this.each(ctx, ids, async (tx, id) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (!o.deliveryDriverId) throw new BadRequestException('Assign a delivery driver first, so the COD is on the right driver');
      if (o.status === 'ASSIGNED_TO_DRIVER') await this.orders.transitionInTx(tx, ctx, id, 'HEADING_TO_CUSTOMER', { note: 'Out for delivery' });
      const r = await this.orders.transitionInTx(tx, ctx, id, 'DELIVERED', { note: note || 'Delivered', metadata: { deliveryDriverId: o.deliveryDriverId, codCollected: o.codAmount } });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Failed attempt with one of the 7 reasons: the order waits for the merchant's decision. */
  async markFailed(ctx: RequestContext, ids: string[], reason: FailedAttemptReason, note?: string) {
    if (!FAILED_ATTEMPT_REASONS.includes(reason)) throw new BadRequestException('Unknown failure reason');
    return this.each(ctx, ids, async (tx, id) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      if (o.status === 'ASSIGNED_TO_DRIVER') await this.orders.transitionInTx(tx, ctx, id, 'HEADING_TO_CUSTOMER', { note: 'Out for delivery' });
      const text = FAILED_REASON_TEXT[reason];
      const r = await this.orders.transitionInTx(tx, ctx, id, 'AWAITING_MERCHANT_ACTION', {
        data: { attempts: { increment: 1 }, lastFailedReason: reason },
        note: `Failed attempt: ${text}${note ? ` (${note})` : ''}`,
        metadata: { failedReason: reason, deliveryDriverId: o.deliveryDriverId, attempt: o.attempts + 1 },
      });
      await this.alerts.raiseIf(tx, o.attempts + 1 >= 3, {
        kind: 'REPEATED_FAILURE',
        severity: 'MEDIUM',
        message: `${o.trackingNumber} failed ${o.attempts + 1} times (last: ${text})`,
        entityType: 'order',
        entityId: o.id,
      });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Send failed or cancelled orders back: from the last mile hub towards the sorting facility. */
  async startReturn(ctx: RequestContext, ids: string[], note?: string) {
    return this.each(ctx, ids, async (tx, id) => {
      const r = await this.orders.transitionInTx(tx, ctx, id, 'RETURNS_ON_WAY', { note: note || 'Return to merchant started' });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  /** Returns at the sorting facility: assign the driver taking them back to the merchant. */
  async returnToMerchant(ctx: RequestContext, ids: string[], driverId: string) {
    return this.each(ctx, ids, async (tx, id) => {
      const d = await this.drivers.requireActive(tx, driverId, 'PICKUP');
      const r = await this.orders.transitionInTx(tx, ctx, id, 'HEADING_TO_MERCHANT', { data: { pickupDriverId: d.id }, note: `Returning to merchant with ${d.fullName}` });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  async markReturned(ctx: RequestContext, ids: string[]) {
    return this.each(ctx, ids, async (tx, id) => {
      const r = await this.orders.transitionInTx(tx, ctx, id, 'RETURNED', { note: 'Returned to merchant' });
      return { trackingNumber: r.trackingNumber, status: r.to };
    });
  }

  async returnsBoard(ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) =>
      tx.order.findMany({
        where: { isReturning: true, status: { in: ['RETURNS_ON_WAY', 'AT_SORTING_FACILITY', 'HEADING_TO_MERCHANT'] } },
        select: {
          id: true, trackingNumber: true, status: true, lastFailedReason: true, customerName: true, updatedAt: true,
          merchant: { select: { nameEn: true, nameAr: true } },
          pickupLocation: { select: { name: true, area: true } },
          pickupDriver: { select: { fullName: true } },
        },
        orderBy: { updatedAt: 'asc' },
      }),
    );
  }

  private event(tx: Tx, ctx: RequestContext, o: { id: string; merchantId: string }, type: string, note: string, metadata: Record<string, unknown>) {
    return tx.orderEvent.create({
      data: { orderId: o.id, merchantId: o.merchantId, eventType: type, note, actorId: ctx.userId, actorRole: ctx.role, metadata: metadata as object },
    });
  }
}

export type { OrderStatus };
