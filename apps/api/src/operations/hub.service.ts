import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Hub, Order } from '@prisma/client';
import { OrderStatus } from '@shiply/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AlertsService } from './alerts.service';

export interface ScanResult {
  ok: boolean;
  code: string;
  trackingNumber?: string;
  from?: string;
  to?: string;
  message: string;
  warning?: string;
}

const STATUSES_HELD_BY_DRIVER: OrderStatus[] = ['ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER'];

/**
 * Hub operations: receiving parcels by scan, hub inventory and transfer manifests between hubs.
 * A scan accepts the tracking number typed or read by a barcode scanner (which types and presses Enter).
 */
@Injectable()
export class HubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly alerts: AlertsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private async findByCode(tx: Tx, code: string) {
    const tn = code.trim().toUpperCase();
    return tx.order.findUnique({ where: { trackingNumber: tn } });
  }

  /** Decides the status a parcel takes when it is received at this hub. */
  static receiveTarget(o: Pick<Order, 'status' | 'isReturning'>, hub: Pick<Hub, 'receivesPickups' | 'dispatchesLastMile'>): OrderStatus | 'LOCATION_ONLY' | null {
    switch (o.status as OrderStatus) {
      case 'PENDING_PICKUP':
      case 'PICKED_UP':
        return hub.receivesPickups ? 'AT_SORTING_FACILITY' : hub.dispatchesLastMile ? 'AT_LAST_MILE_HUB' : null;
      case 'IN_TRANSFER':
        return hub.dispatchesLastMile && !o.isReturning ? 'AT_LAST_MILE_HUB' : 'AT_SORTING_FACILITY';
      case 'RETURNS_ON_WAY':
        return 'AT_SORTING_FACILITY';
      case 'ASSIGNED_TO_DRIVER':
      case 'HEADING_TO_CUSTOMER':
        return 'AT_LAST_MILE_HUB';
      case 'AWAITING_MERCHANT_ACTION':
      case 'REJECTED_RETURN':
        return 'LOCATION_ONLY';
      default:
        return null;
    }
  }

  async receive(ctx: RequestContext, hubId: string, code: string): Promise<ScanResult> {
    try {
      return await this.prisma.withContext(ctx, async (tx) => {
        const hub = await tx.hub.findUnique({ where: { id: hubId } });
        if (!hub) throw new NotFoundException('Hub not found');
        const o = await this.findByCode(tx, code);
        if (!o) return { ok: false, code, message: 'Unknown tracking number' };
        const target = HubService.receiveTarget(o, hub);
        if (!target) return { ok: false, code, trackingNumber: o.trackingNumber, from: o.status, message: `Cannot receive an order that is ${o.status}` };
        if (o.currentHubId === hubId && (target === 'LOCATION_ONLY' || o.status === target)) {
          return { ok: true, code, trackingNumber: o.trackingNumber, from: o.status, to: o.status, message: 'Already at this hub' };
        }
        // An open transfer item for this order is closed by receiving it here.
        const item = await tx.transferItem.findFirst({ where: { orderId: o.id, scannedInAt: null, transfer: { status: 'IN_TRANSIT' } }, include: { transfer: true } });
        let warning: string | undefined;
        if (item && item.transfer.destinationHubId !== hubId) warning = `Transfer ${item.transfer.code} was going to another hub`;
        if (target === 'AT_LAST_MILE_HUB' && o.destinationHubId && o.destinationHubId !== hubId && !STATUSES_HELD_BY_DRIVER.includes(o.status as OrderStatus)) {
          warning = 'Misroute: this parcel belongs to another last mile hub';
          await this.alerts.raise(tx, { kind: 'MISROUTE', severity: 'MEDIUM', message: `${o.trackingNumber} received at ${hub.code} but routed to another hub`, entityType: 'order', entityId: o.id });
        }
        if (target === 'LOCATION_ONLY') {
          await tx.order.update({ where: { id: o.id }, data: { currentHubId: hubId } });
          await tx.orderEvent.create({
            data: { orderId: o.id, merchantId: o.merchantId, eventType: 'HUB_RECEIVED', hubId, note: `Back at ${hub.nameEn}`, actorId: ctx.userId, actorRole: ctx.role },
          });
        } else {
          await this.orders.transitionInTx(tx, ctx, o.id, target, {
            data: { currentHubId: hubId, ...(target === 'AT_LAST_MILE_HUB' && STATUSES_HELD_BY_DRIVER.includes(o.status as OrderStatus) ? { deliveryDriverId: null } : {}) },
            hubId,
            note: `Scanned in at ${hub.nameEn}`,
          });
        }
        if (item) {
          await tx.transferItem.update({ where: { id: item.id }, data: { scannedInAt: new Date() } });
          await this.maybeCompleteTransfer(tx, item.transferId);
        }
        return { ok: true, code, trackingNumber: o.trackingNumber, from: o.status, to: target === 'LOCATION_ONLY' ? o.status : target, message: 'Received', warning };
      });
    } catch (e) {
      return { ok: false, code, message: (e as Error).message };
    }
  }

  async inventory(ctx: RequestContext, hubId: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const orders = await tx.order.findMany({
        where: { currentHubId: hubId, status: { in: ['AT_SORTING_FACILITY', 'AT_LAST_MILE_HUB', 'AWAITING_MERCHANT_ACTION', 'REJECTED_RETURN'] } },
        select: {
          id: true, trackingNumber: true, status: true, isReturning: true, codAmount: true, updatedAt: true, governorateCode: true, area: true,
          destinationHub: { select: { id: true, code: true } },
          merchant: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      const byStatus: Record<string, number> = {};
      for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      return { total: orders.length, byStatus, orders };
    });
  }

  // ───── Transfers ─────

  async createTransfer(ctx: RequestContext, input: { originHubId: string; destinationHubId: string; driverId?: string | null; vehicle?: string | null }) {
    if (input.originHubId === input.destinationHubId) throw new BadRequestException('Origin and destination must be different hubs');
    return this.prisma.withContext(ctx, async (tx) => {
      const [origin, dest] = await Promise.all([tx.hub.findUnique({ where: { id: input.originHubId } }), tx.hub.findUnique({ where: { id: input.destinationHubId } })]);
      if (!origin || !dest) throw new NotFoundException('Hub not found');
      const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const count = await tx.transfer.count({ where: { originHubId: origin.id, createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } } });
      const t = await tx.transfer.create({
        data: { code: `TRF-${origin.code}-${dest.code}-${day}-${count + 1}`, originHubId: origin.id, destinationHubId: dest.id, driverId: input.driverId ?? null, vehicle: input.vehicle ?? null, createdById: ctx.userId },
      });
      await this.audit.record(tx, ctx, { action: 'transfer.create', entityType: 'transfer', entityId: t.id, after: t });
      return t;
    });
  }

  listTransfers(ctx: RequestContext, status?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const list = await tx.transfer.findMany({
        where: status ? { status: status as never } : {},
        include: {
          originHub: { select: { code: true, nameEn: true, nameAr: true } },
          destinationHub: { select: { code: true, nameEn: true, nameAr: true } },
          driver: { select: { fullName: true } },
          items: { select: { scannedInAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return list.map(({ items, ...t }) => ({ ...t, itemCount: items.length, receivedCount: items.filter((i) => i.scannedInAt).length }));
    });
  }

  getTransfer(ctx: RequestContext, id: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const t = await tx.transfer.findUnique({
        where: { id },
        include: {
          originHub: true,
          destinationHub: true,
          driver: { select: { fullName: true, phone: true } },
          items: { include: { order: { select: { id: true, trackingNumber: true, status: true, codAmount: true, area: true, merchant: { select: { nameEn: true, nameAr: true } } } } }, orderBy: { scannedOutAt: 'asc' } },
        },
      });
      if (!t) throw new NotFoundException('Transfer not found');
      return t;
    });
  }

  /** Scan OUT at the origin: the parcel must be sitting at the origin hub. */
  async scanOut(ctx: RequestContext, transferId: string, code: string): Promise<ScanResult> {
    try {
      return await this.prisma.withContext(ctx, async (tx) => {
        const t = await tx.transfer.findUnique({ where: { id: transferId } });
        if (!t) throw new NotFoundException('Transfer not found');
        if (t.status !== 'OPEN') return { ok: false, code, message: 'This transfer has already left' };
        const o = await this.findByCode(tx, code);
        if (!o) return { ok: false, code, message: 'Unknown tracking number' };
        if (o.currentHubId !== t.originHubId) return { ok: false, code, trackingNumber: o.trackingNumber, message: 'This parcel is not at the origin hub; scan it in there first' };
        if (!['AT_SORTING_FACILITY', 'AT_LAST_MILE_HUB'].includes(o.status)) return { ok: false, code, trackingNumber: o.trackingNumber, message: `Cannot transfer an order that is ${o.status}` };
        const exists = await tx.transferItem.findUnique({ where: { transferId_orderId: { transferId, orderId: o.id } } });
        if (exists) return { ok: true, code, trackingNumber: o.trackingNumber, message: 'Already on this manifest' };
        let warning: string | undefined;
        if (!o.isReturning && o.destinationHubId && o.destinationHubId !== t.destinationHubId) warning = 'This parcel is routed to a different hub';
        await tx.transferItem.create({ data: { transferId, orderId: o.id } });
        return { ok: true, code, trackingNumber: o.trackingNumber, message: 'Added to manifest', warning };
      });
    } catch (e) {
      return { ok: false, code, message: (e as Error).message };
    }
  }

  /** Vehicle leaves: every parcel on the manifest becomes In Transfer (or Returns On Way). */
  async dispatch(ctx: RequestContext, transferId: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const t = await tx.transfer.findUnique({ where: { id: transferId }, include: { items: { include: { order: true } }, originHub: true, destinationHub: true } });
      if (!t) throw new NotFoundException('Transfer not found');
      if (t.status !== 'OPEN') throw new BadRequestException('Transfer already dispatched');
      if (t.items.length === 0) throw new BadRequestException('Scan at least one parcel before dispatching');
      for (const it of t.items) {
        const o = it.order;
        const returning = o.isReturning || (o.status === 'AT_LAST_MILE_HUB' && t.destinationHub.receivesPickups && !t.destinationHub.dispatchesLastMile);
        await this.orders.transitionInTx(tx, ctx, o.id, returning ? 'RETURNS_ON_WAY' : 'IN_TRANSFER', {
          data: { currentHubId: null },
          hubId: t.originHubId,
          note: `Left ${t.originHub.nameEn} on ${t.code}`,
          metadata: { transferId: t.id },
        });
      }
      const done = await tx.transfer.update({ where: { id: t.id }, data: { status: 'IN_TRANSIT', dispatchedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: 'transfer.dispatch', entityType: 'transfer', entityId: t.id, after: { items: t.items.length } });
      return done;
    });
  }

  /** Scan IN at the destination. */
  async scanIn(ctx: RequestContext, transferId: string, code: string): Promise<ScanResult> {
    const t = await this.prisma.withContext(ctx, (tx) => tx.transfer.findUnique({ where: { id: transferId } }));
    if (!t) return { ok: false, code, message: 'Transfer not found' };
    if (t.status !== 'IN_TRANSIT') return { ok: false, code, message: 'This transfer is not in transit' };
    const onManifest = await this.prisma.withContext(ctx, async (tx) => {
      const o = await this.findByCode(tx, code);
      return o ? tx.transferItem.findUnique({ where: { transferId_orderId: { transferId, orderId: o.id } } }) : null;
    });
    const r = await this.receive(ctx, t.destinationHubId, code);
    if (r.ok && !onManifest) r.warning = 'Not on this manifest (received anyway)';
    return r;
  }

  /** Closes a transfer; anything not scanned in raises a missing parcel alert. */
  async closeTransfer(ctx: RequestContext, transferId: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const t = await tx.transfer.findUnique({ where: { id: transferId }, include: { items: { include: { order: true } } } });
      if (!t) throw new NotFoundException('Transfer not found');
      if (t.status !== 'IN_TRANSIT') throw new BadRequestException('Only a transfer in transit can be closed');
      const missing = t.items.filter((i) => !i.scannedInAt);
      for (const m of missing) {
        await this.alerts.raise(tx, {
          kind: 'MISSING_SCAN_IN',
          severity: 'HIGH',
          message: `${m.order.trackingNumber} left on ${t.code} but was not scanned in at the destination`,
          entityType: 'order',
          entityId: m.orderId,
          data: { transferId: t.id },
        });
      }
      const done = await tx.transfer.update({ where: { id: t.id }, data: { status: 'RECEIVED', receivedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: 'transfer.close', entityType: 'transfer', entityId: t.id, after: { missing: missing.length } });
      return { ...done, missing: missing.map((m) => m.order.trackingNumber) };
    });
  }

  private async maybeCompleteTransfer(tx: Tx, transferId: string) {
    const left = await tx.transferItem.count({ where: { transferId, scannedInAt: null } });
    if (left === 0) await tx.transfer.update({ where: { id: transferId }, data: { status: 'RECEIVED', receivedAt: new Date() } });
  }

  /** Alerts for transfers still in transit longer than expected (spec 7: 30 minutes after expected arrival). */
  async checkOverdueTransfers() {
    const minutes = await this.config.getInt('hubs.missing_scan_alert_minutes');
    const transitHours = 3;
    await this.prisma.asSystem(async (tx) => {
      const overdue = await tx.transfer.findMany({
        where: { status: 'IN_TRANSIT', dispatchedAt: { lt: new Date(Date.now() - (transitHours * 60 + minutes) * 60_000) } },
      });
      for (const t of overdue) {
        await this.alerts.raise(tx, { kind: 'TRANSFER_OVERDUE', severity: 'HIGH', message: `Transfer ${t.code} has not been fully scanned in`, entityType: 'transfer', entityId: t.id });
      }
    });
  }
}
