import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ALLOWED_TRANSITIONS,
  buildTrackingNumber,
  canTransition,
  isMerchantRole,
  isMerchantTransition,
  normalizeEgyptianPhone,
  OrderStatus,
  ORDER_STATUSES,
  PricingZone,
  Role,
  STATUS_GROUP_OF,
  statusesInGroup,
} from '@shiply/shared';
import { LedgerService } from '../accounting/ledger.service';
import { codCollected } from '../accounting/posting';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { ZoneService } from '../geo/zone.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { PricingError, PricingService } from '../pricing/pricing.service';
import { CreateOrderInput, ListOrdersQuery } from './orders.schemas';

export class OrderInputError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
  }
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly zones: ZoneService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  resolveMerchantId(ctx: RequestContext, requested?: string | null): string {
    if (isMerchantRole(ctx.role as Role)) {
      if (!ctx.merchantId) throw new ForbiddenException('No merchant on this account');
      return ctx.merchantId;
    }
    if (!requested) throw new BadRequestException('merchantId is required for staff');
    return requested;
  }

  /** Public entry point for a single order. */
  async create(ctx: RequestContext, input: CreateOrderInput, source: 'MANUAL' | 'CSV' | 'API' = 'MANUAL') {
    const merchantId = this.resolveMerchantId(ctx, input.merchantId);
    try {
      return await this.prisma.withContext(ctx, (tx) => this.createInTx(tx, ctx, merchantId, input, source, null));
    } catch (e) {
      if (e instanceof OrderInputError) {
        throw new BadRequestException({ message: e.message, errors: [{ path: e.field, message: e.message }] });
      }
      throw e;
    }
  }

  /**
   * Validates, geocodes, detects zone and hub, prices (frozen), assigns a tracking number,
   * then writes the order, its first order_event and an audit row in the caller's transaction.
   */
  async createInTx(
    tx: Tx,
    ctx: RequestContext,
    merchantId: string,
    input: CreateOrderInput,
    source: 'MANUAL' | 'CSV' | 'API',
    importBatchId: string | null,
  ) {
    const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, include: { parent: true } });
    if (!merchant || merchant.archived) throw new OrderInputError('merchantId', 'Merchant not found');
    // Sub accounts inherit the parent's pricing tier.
    const tier = merchant.parent?.tier ?? merchant.tier;

    const phone = normalizeEgyptianPhone(input.customerPhone);
    if (!phone) throw new OrderInputError('customerPhone', 'Invalid Egyptian mobile number (+20, 11 digits)');
    let phoneAlt: string | null = null;
    if (input.customerPhoneAlt) {
      phoneAlt = normalizeEgyptianPhone(input.customerPhoneAlt);
      if (!phoneAlt) throw new OrderInputError('customerPhoneAlt', 'Invalid alternative Egyptian mobile number');
    }

    const maxCod = await this.config.getInt('orders.max_cod_amount', tx);
    if (input.codAmount > maxCod) throw new OrderInputError('codAmount', `COD exceeds the maximum of ${maxCod / 100} EGP`);
    if (input.type === 'RETURN' && input.codAmount > 0) {
      throw new OrderInputError('codAmount', 'Return orders cannot collect COD');
    }

    const gov = await tx.governorate.findUnique({ where: { code: input.governorateCode.toUpperCase() } });
    if (!gov) throw new OrderInputError('governorateCode', `Unknown governorate ${input.governorateCode}`);

    const pickup = input.pickupLocationId
      ? await tx.pickupLocation.findFirst({ where: { id: input.pickupLocationId, merchantId, archived: false } })
      : await tx.pickupLocation.findFirst({ where: { merchantId, archived: false }, orderBy: { isDefault: 'desc' } });
    if (!pickup) throw new OrderInputError('pickupLocationId', 'Merchant has no pickup location');

    const pickupZone = await this.zones.detect(
      tx,
      { governorateCode: pickup.governorateCode, area: pickup.area, addressLine: pickup.addressLine },
      { withHub: false },
    );
    const dest = await this.zones.detect(
      tx,
      { governorateCode: gov.code, area: input.area, addressLine: input.addressLine },
      { withHub: true },
    );

    const size = input.size ?? merchant.defaultSize;
    const allowOpenPackage = input.allowOpenPackage ?? merchant.defaultOpenPackage;
    let price;
    try {
      price = await this.pricing.quote(tx, {
        pickupZone: pickupZone.zone,
        destZone: dest.zone,
        size,
        orderType: input.type,
        tier,
        codAmount: input.codAmount,
        allowOpenPackage,
        vatEnabled: merchant.vatEnabled,
      });
    } catch (e) {
      if (e instanceof PricingError) throw new OrderInputError('governorateCode', e.message);
      throw e;
    }

    const prefix = await this.config.getString('orders.tracking_prefix', tx);
    const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('tracking_number_seq')`;
    const trackingNumber = buildTrackingNumber(prefix, Number(nextval));

    const order = await tx.order.create({
      data: {
        merchantId,
        trackingNumber,
        merchantReference: input.merchantReference || null,
        type: input.type,
        size,
        source,
        customerName: input.customerName,
        customerPhone: phone,
        customerPhoneAlt: phoneAlt,
        governorateCode: gov.code,
        area: input.area,
        addressLine: input.addressLine,
        lat: dest.geocode?.lat ?? null,
        lng: dest.geocode?.lng ?? null,
        geocodeSource: dest.geocode ? `${dest.geocode.source}:${dest.geocode.precision}` : null,
        pickupLocationId: pickup.id,
        pickupZone: pickupZone.zone,
        destZone: dest.zone,
        destinationHubId: dest.hubId,
        needsManualHub: dest.needsManualHub,
        codAmount: input.codAmount,
        allowOpenPackage,
        itemsDescription: input.itemsDescription || null,
        returnItemsDescription: input.returnItemsDescription || null,
        notes: input.notes || null,
        shippingFee: price.shippingFee,
        codFee: price.codFee,
        openPackageFee: price.openPackageFee,
        vatAmount: price.vatAmount,
        totalFees: price.totalFees,
        failedDeliveryFee: price.failedDeliveryFee,
        pricingSnapshot: price.snapshot as Prisma.InputJsonValue,
        importBatchId,
        createdById: ctx.userId,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        merchantId,
        eventType: 'CREATED',
        toStatus: 'NEW',
        actorId: ctx.userId,
        actorRole: ctx.role,
        note: `Created via ${source}`,
        metadata: {
          trackingNumber,
          totalFees: price.totalFees,
          destinationHubId: dest.hubId,
          needsManualHub: dest.needsManualHub,
        },
      },
    });
    if (dest.needsManualHub) {
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          merchantId,
          eventType: 'MANUAL_HUB_REQUIRED',
          actorRole: 'SYSTEM',
          note: 'Destination outside all last mile hub coverage (dead zone candidate)',
          metadata: { lat: dest.geocode?.lat ?? null, lng: dest.geocode?.lng ?? null, zone: dest.zone as PricingZone },
        },
      });
    }
    await this.audit.record(tx, ctx, {
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      merchantId,
      after: { trackingNumber, status: order.status, totalFees: order.totalFees, codAmount: order.codAmount, source },
    });
    return order;
  }

  async list(ctx: RequestContext, q: ListOrdersQuery) {
    const where: Prisma.OrderWhereInput = { archived: false };
    if (q.status) where.status = q.status;
    else if (q.group) where.status = { in: statusesInGroup(q.group) };
    if (q.printed === 'true') where.printCount = { gt: 0 };
    if (q.printed === 'false') where.printCount = 0;
    if (q.governorateCode) where.governorateCode = q.governorateCode;
    if (q.type) where.type = q.type;
    if (q.needsManualHub) where.needsManualHub = q.needsManualHub === 'true';
    if (q.merchantId && !isMerchantRole(ctx.role as Role)) where.merchantId = q.merchantId;
    if (q.from || q.to) {
      where.createdAt = {
        gte: q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
        lt: q.to ? new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86400_000) : undefined,
      };
    }
    if (q.q) {
      const phone = normalizeEgyptianPhone(q.q);
      where.OR = [
        { trackingNumber: { contains: q.q.toUpperCase() } },
        { customerName: { contains: q.q, mode: 'insensitive' } },
        { merchantReference: { contains: q.q, mode: 'insensitive' } },
        ...(phone ? [{ customerPhone: phone }] : []),
      ];
    }
    return this.prisma.withContext(ctx, async (tx) => {
      const [total, items] = await Promise.all([
        tx.order.count({ where }),
        tx.order.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: {
            destinationHub: { select: { code: true, nameEn: true, nameAr: true } },
            merchant: { select: { nameEn: true, nameAr: true, code: true } },
          },
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: items.map(withGroup) };
    });
  }

  async get(ctx: RequestContext, idOrTracking: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const isUuid = /^[0-9a-f-]{36}$/i.test(idOrTracking);
      const order = await tx.order.findFirst({
        where: isUuid ? { id: idOrTracking } : { trackingNumber: idOrTracking.toUpperCase() },
        include: {
          merchant: { select: { id: true, nameEn: true, nameAr: true, code: true, logoUrl: true } },
          destinationHub: true,
          pickupLocation: true,
          governorate: true,
          events: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const [stats] = await tx.$queryRaw<{ delivered: bigint; unsuccessful: bigint }[]>`
        SELECT * FROM customer_success_stats(${order.customerPhone})`;
      const delivered = Number(stats.delivered);
      const finished = delivered + Number(stats.unsuccessful);
      const allowed = ALLOWED_TRANSITIONS[order.status as OrderStatus].filter(
        (to) => !isMerchantRole(ctx.role as Role) || isMerchantTransition(order.status as OrderStatus, to),
      );
      return {
        ...withGroup(order),
        events: order.events.map((e) => ({ ...e, id: e.id.toString() })),
        customerScore: {
          delivered,
          finished,
          percent: finished === 0 ? null : Math.round((delivered * 100) / finished),
        },
        allowedTransitions: allowed,
      };
    });
  }

  async transition(ctx: RequestContext, id: string, to: OrderStatus, note?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order not found');
      const from = order.status as OrderStatus;
      if (!canTransition(from, to)) throw new BadRequestException(`Transition ${from} → ${to} is not allowed`);
      if (isMerchantRole(ctx.role as Role) && !isMerchantTransition(from, to)) {
        throw new ForbiddenException(`Merchants cannot move an order from ${from} to ${to}`);
      }
      // Optimistic concurrency: only succeeds if nobody moved the order meanwhile.
      const res = await tx.order.updateMany({ where: { id, status: from }, data: { status: to } });
      if (res.count !== 1) throw new BadRequestException('Order status changed concurrently, reload and retry');
      await tx.orderEvent.create({
        data: {
          orderId: id,
          merchantId: order.merchantId,
          eventType: 'STATUS_CHANGED',
          fromStatus: from,
          toStatus: to,
          note: note ?? null,
          actorId: ctx.userId,
          actorRole: ctx.role,
        },
      });
      await this.onFinalStatus(tx, ctx, order, to);
      await this.audit.record(tx, ctx, {
        action: 'order.transition',
        entityType: 'order',
        entityId: id,
        merchantId: order.merchantId,
        before: { status: from },
        after: { status: to },
        reason: note,
      });
      return { id, from, to };
    });
  }

  /**
   * Money side effects of a status change, in the same transaction:
   * Delivered records the COD as cash with the driver; every final status is stamped so the
   * midnight cash cycle settles it into the merchant wallet.
   */
  private async onFinalStatus(tx: Tx, ctx: RequestContext, order: { id: string } & Parameters<typeof codCollected>[0], to: OrderStatus) {
    if (!['DELIVERED', 'RETURNED', 'UNSUCCESSFUL'].includes(to)) return;
    const now = new Date();
    await tx.order.update({ where: { id: order.id }, data: { finalizedAt: now } });
    if (to === 'DELIVERED' && order.codAmount > 0) {
      await this.ledger.post(tx, {
        type: 'COD_COLLECTED',
        description: `COD collected for ${order.trackingNumber}`,
        idempotencyKey: `cod:${order.id}`,
        lines: codCollected(order),
        merchantId: order.merchantId,
        orderId: order.id,
        occurredAt: now,
        createdById: ctx.userId,
      });
    }
  }

  /** Records that labels were printed (feeds the printed / not printed filter). */
  async markPrinted(tx: Tx, ctx: RequestContext, ids: string[]) {
    const now = new Date();
    const orders = await tx.order.findMany({ where: { id: { in: ids } }, select: { id: true, merchantId: true, printCount: true } });
    for (const o of orders) {
      await tx.order.update({ where: { id: o.id }, data: { printCount: { increment: 1 }, labelPrintedAt: now } });
      await tx.orderEvent.create({
        data: {
          orderId: o.id,
          merchantId: o.merchantId,
          eventType: 'LABEL_PRINTED',
          actorId: ctx.userId,
          actorRole: ctx.role,
          metadata: { printNumber: o.printCount + 1 },
        },
      });
    }
    await this.audit.record(tx, ctx, {
      action: 'order.label_print',
      entityType: 'order',
      entityId: ids.length === 1 ? ids[0] : null,
      after: { ids, count: orders.length },
    });
  }

  async dashboard(ctx: RequestContext, merchantId?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const where: Prisma.OrderWhereInput = { archived: false, ...(merchantId ? { merchantId } : {}) };
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [byStatus, todayByStatus, expected, collected] = await Promise.all([
        tx.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tx.order.groupBy({ by: ['status'], where: { ...where, createdAt: { gte: startOfDay } }, _count: { _all: true } }),
        tx.order.aggregate({
          where: { ...where, status: { notIn: ['DELIVERED', 'RETURNED', 'UNSUCCESSFUL', 'ARCHIVED', 'TERMINATED'] } },
          _sum: { codAmount: true },
        }),
        tx.order.aggregate({ where: { ...where, status: 'DELIVERED' }, _sum: { codAmount: true } }),
      ]);
      const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
      for (const r of byStatus) counts[r.status as OrderStatus] = r._count._all;
      const today = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
      for (const r of todayByStatus) today[r.status as OrderStatus] = r._count._all;
      const groups: Record<string, number> = {};
      for (const s of ORDER_STATUSES) groups[STATUS_GROUP_OF[s]] = (groups[STATUS_GROUP_OF[s]] ?? 0) + counts[s];

      let nextCashoutDate: string | null = null;
      if (merchantId) {
        const m = await tx.merchant.findUnique({ where: { id: merchantId } });
        if (m) nextCashoutDate = nextCashout(m.cashoutFrequency, new Date()).toISOString().slice(0, 10);
      }
      return {
        counts,
        today,
        groups,
        awaitingAction: counts.AWAITING_MERCHANT_ACTION,
        expectedCod: expected._sum.codAmount ?? 0,
        collectedCod: collected._sum.codAmount ?? 0,
        nextCashoutDate,
      };
    });
  }
}

function withGroup<T extends { status: string }>(o: T) {
  return { ...o, statusGroup: STATUS_GROUP_OF[o.status as OrderStatus] };
}

/** Simplest schedule until Phase 5 finance: daily → tomorrow, every 2 days → +2, weekly → next Sunday. */
export function nextCashout(freq: string, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (freq === 'DAILY') d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === 'EVERY_2_DAYS') d.setUTCDate(d.getUTCDate() + 2);
  else d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay() || 7));
  return d;
}
