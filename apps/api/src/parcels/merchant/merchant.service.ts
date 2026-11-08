import { Injectable } from '@nestjs/common';
import { type Prisma, type Shipment, payoutDueOn } from '@shiplynow/db';
import { addDays, cairoDay } from '@shiplynow/shared';
import {
  PARCEL_SIZES,
  codFee,
  makeTrackingNumber,
  normalizeEgyptPhone,
  type ParcelSize,
  type SettingValues,
  addBusinessDays,
  cairoClock,
  parseTime,
} from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { nextCode, nextNumber } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo } from '../core/shipments.core';
import { parcelFees, priceFor } from './pricing';
import { queueShipmentWebhooks } from '../common/webhooks';

const MAX_COD = 100_000 * 100; // 100,000 EGP

export const ShipmentInput = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerPhone: z.string().trim().min(8).max(20),
  address: z.string().trim().min(5).max(400),
  governorateCode: z.string().trim().min(4).max(6),
  areaId: z.string().min(1).max(64).nullish(),
  size: z.enum(PARCEL_SIZES).default('M'),
  codAmount: z.number().int().min(0).max(MAX_COD).default(0),
  /** What the goods are worth (piastres): a loss or damage is paid on it, up to the cap. */
  declaredValue: z.number().int().min(0).max(MAX_COD).default(0),
  description: z.string().trim().max(300).default(''),
  notes: z.string().trim().max(300).default(''),
  allowOpen: z.boolean().default(false),
  merchantRef: z.string().trim().max(60).default(''),
  /** Deliver the new item and bring the old one back in the same visit. */
  exchange: z.boolean().default(false),
  /** A return: the courier collects it from the customer and brings it to the merchant. */
  customerReturn: z.boolean().default(false),
});
export type ShipmentInputT = z.infer<typeof ShipmentInput>;

const DecisionInput = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('REATTEMPT'),
    customerPhone: z.string().trim().min(8).max(20).optional(),
    address: z.string().trim().min(5).max(400).optional(),
    governorateCode: z.string().trim().min(4).max(6).optional(),
    areaId: z.string().min(1).max(64).nullish(),
    note: z.string().trim().max(300).default(''),
  }),
  z.object({ decision: z.literal('RETURN'), note: z.string().trim().max(300).default('') }),
]);

const PickupInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(300).default(''),
});

const ListQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  /** Creates one parcel. Used by the merchant portal, CSV upload and admin. */
  async create(merchantId: string, input: unknown, userId: string): Promise<Shipment> {
    const data = parse(ShipmentInput, input);
    const phone = normalizeEgyptPhone(data.customerPhone);
    if (!phone)
      throw new DomainError(
        'invalid_input',
        'Customer phone must be an Egyptian mobile number',
        422,
      );
    return this.prisma.tx(async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id: merchantId } });
      if (!merchant || !merchant.isActive)
        throw new DomainError('forbidden', 'This merchant account is not active', 403);
      if (merchant.approval !== 'approved')
        throw new DomainError('forbidden', 'This merchant account is waiting for approval', 403);
      if (!merchant.homeHubId || !merchant.governorateCode)
        throw new DomainError(
          'no_pickup_address',
          'Add your pickup address before sending parcels',
          422,
        );
      const home = { homeHubId: merchant.homeHubId, governorateCode: merchant.governorateCode };
      const settings = await this.settings.all(tx);
      if (data.customerReturn && (data.codAmount > 0 || data.exchange || data.allowOpen)) {
        throw new DomainError(
          'invalid_input',
          'A return from a customer has no cash to collect, no exchange and no opening',
          422,
        );
      }
      const price = await priceFor(tx, this.core, settings, {
        merchantId,
        discountBp: merchant.discountBp,
        governorateCode: data.governorateCode,
        areaId: data.areaId ?? null,
        size: data.size as ParcelSize,
        allowOpen: data.allowOpen,
        exchange: data.exchange,
      });
      const hubId = price.hubId;
      // We pick up only where we deliver: a merchant outside our area cannot send yet.
      await this.core.deliveryHubFor(tx, home.governorateCode, merchant.areaId).catch(() => {
        throw new DomainError('not_served', 'We do not pick up from your area yet', 422);
      });
      // The whole way, planned now: a return from a customer travels the other way.
      const route = await this.core.plan(
        tx,
        data.customerReturn ? 'RETURN' : 'FORWARD',
        home.homeHubId,
        hubId,
      );
      const cod = codFee(data.codAmount, await parcelFees(tx, merchantId, settings));
      const trackingNumber = makeTrackingNumber(
        settings['tracking.prefix'],
        await nextNumber(tx, 'tracking_seq'),
      );
      const shipment = await tx.shipment.create({
        data: {
          trackingNumber,
          merchantId,
          merchantRef: data.merchantRef,
          customerName: data.customerName,
          customerPhone: phone,
          address: data.address,
          governorateCode: data.governorateCode,
          areaId: data.areaId ?? null,
          size: data.size,
          description: data.description,
          notes: data.notes,
          allowOpen: data.allowOpen,
          codAmount: data.codAmount,
          declaredValue: data.declaredValue,
          originHubId: home.homeHubId,
          destinationHubId: hubId,
          shippingFee: price.shippingFee,
          basePrice: price.basePrice,
          discount: price.discount,
          openFee: price.openFee,
          exchangeFee: price.exchangeFee,
          kind: data.customerReturn ? 'CUSTOMER_RETURN' : data.exchange ? 'EXCHANGE' : 'NORMAL',
          route,
          codFee: cod,
        },
      });
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          type: 'CREATED',
          toStatus: 'CREATED',
          userId,
          note: data.customerReturn ? 'Return to collect from the customer' : '',
        },
      });
      if (!data.customerReturn && settings['pickups.auto_request'] === 'ON')
        await this.autoPickup(tx, { id: merchant.id, homeHubId: home.homeHubId }, settings);
      await queueShipmentWebhooks(tx, shipment.id, null, 'CREATED');
      return shipment;
    });
  }

  /** CSV upload: every row is its own transaction, so one bad row never blocks the rest. */
  async createMany(merchantId: string, rows: unknown, userId: string) {
    if (!Array.isArray(rows) || rows.length === 0)
      throw new DomainError('invalid_input', 'No rows to import', 422);
    if (rows.length > 500)
      throw new DomainError('invalid_input', 'Upload at most 500 rows at a time', 422);
    const created: { row: number; trackingNumber: string }[] = [];
    const failed: { row: number; message: string }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        const s = await this.create(merchantId, row, userId);
        created.push({ row: i + 1, trackingNumber: s.trackingNumber });
      } catch (e) {
        failed.push({
          row: i + 1,
          message: e instanceof DomainError ? e.message : 'Could not create this row',
        });
      }
    }
    return { created, failed };
  }

  async list(merchantId: string, query: unknown) {
    const q = parse(ListQuery, query);
    const where: Prisma.ShipmentWhereInput = { merchantId };
    if (q.status === 'ACTION') where.status = 'ON_HOLD';
    else if (q.status) where.status = q.status as Shipment['status'];
    if (q.q) {
      where.OR = [
        { trackingNumber: { contains: q.q.toUpperCase() } },
        { customerName: { contains: q.q, mode: 'insensitive' } },
        { customerPhone: { contains: q.q.replace(/^0/, '') } },
        { merchantRef: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const take = 50;
    const [items, total, counts] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip: (q.page - 1) * take,
      }),
      this.prisma.shipment.count({ where }),
      this.prisma.shipment.groupBy({ by: ['status'], where: { merchantId }, _count: true }),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: take,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async get(merchantId: string, id: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id, merchantId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw notFound('Parcel');
    return { ...s, ...(await this.payoutOf(s)) };
  }

  /**
   * The payout that covers a closed parcel (paid or prepared), else the next day of the
   * merchant's schedule after it closed, as on the 60 minute order page.
   */
  private async payoutOf(s: Shipment) {
    const m = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: s.merchantId },
      select: { payoutSchedule: true },
    });
    type Payout =
      | { status: 'paid'; number: number; reference: string | null; paidAt: Date | null }
      | { status: 'draft'; number: number }
      | { status: 'next'; day: string }
      | null;
    let payout: Payout = null;
    if (s.payoutId) {
      const p = await this.prisma.payout.findUnique({ where: { id: s.payoutId } });
      if (p?.status === 'paid')
        payout = { status: 'paid', number: p.number, reference: p.reference, paidAt: p.paidAt };
      else if (p) payout = { status: 'draft', number: p.number };
    } else if (s.closedAt && ['DELIVERED', 'RETURNED'].includes(s.status)) {
      const after = cairoDay(s.closedAt);
      const today = cairoDay(new Date());
      let day = addDays(after > today ? after : today, after >= today ? 1 : 0);
      for (let i = 0; i < 7; i++) {
        if (payoutDueOn(m.payoutSchedule, new Date(`${day}T12:00:00Z`).getUTCDay())) break;
        day = addDays(day, 1);
      }
      payout = { status: 'next', day };
    }
    return { payout, payoutSchedule: m.payoutSchedule };
  }

  async cancel(merchantId: string, id: string, userId: string) {
    return this.prisma.tx(async (tx) => {
      const s = await tx.shipment.findFirst({ where: { id, merchantId } });
      if (!s) throw notFound('Parcel');
      if (s.status !== 'CREATED') {
        throw new DomainError(
          'bad_status',
          'Only parcels we have not picked up yet can be cancelled. Ask for a return instead',
          409,
        );
      }
      await this.core.move(
        tx,
        s,
        'CANCELLED',
        { closedAt: new Date() },
        { type: 'CANCELLED', userId },
      );
    });
  }

  /** The merchant answers a parcel that is on hold, or asks for any open parcel to come back. */
  async decide(merchantId: string, id: string, input: unknown, userId: string) {
    const d = parse(DecisionInput, input);
    return this.prisma.tx(async (tx) => {
      const s = await tx.shipment.findFirst({ where: { id, merchantId } });
      if (!s) throw notFound('Parcel');
      if (d.decision === 'RETURN') {
        await requestReturn(tx, this.core, s, {
          type: 'RETURN_REQUESTED',
          userId,
          note: d.note || 'Merchant asked for the parcel back',
        });
        return;
      }
      if (s.status !== 'ON_HOLD' || s.direction !== 'FORWARD') {
        throw new DomainError('bad_status', 'Only parcels on hold can be sent out again', 409);
      }
      const patch: Partial<Shipment> = { holdReason: null };
      const changes: string[] = [];
      if (d.customerPhone) {
        const phone = normalizeEgyptPhone(d.customerPhone);
        if (!phone)
          throw new DomainError(
            'invalid_input',
            'Customer phone must be an Egyptian mobile number',
            422,
          );
        patch.customerPhone = phone;
        changes.push('phone');
      }
      if (d.address) {
        patch.address = d.address;
        changes.push('address');
      }
      if (d.governorateCode && d.governorateCode !== s.governorateCode) {
        const { hubId } = await this.core.deliveryHubFor(tx, d.governorateCode, d.areaId ?? null);
        patch.governorateCode = d.governorateCode;
        patch.areaId = d.areaId ?? null;
        patch.destinationHubId = hubId;
        changes.push('governorate');
      } else if (d.areaId !== undefined && d.areaId !== s.areaId) {
        const { hubId } = await this.core.deliveryHubFor(tx, s.governorateCode, d.areaId ?? null);
        patch.areaId = d.areaId ?? null;
        patch.destinationHubId = hubId;
        changes.push('area');
      }
      const note = [changes.length ? `Updated ${changes.join(', ')}` : '', d.note]
        .filter(Boolean)
        .join('. ');
      await this.core.move(tx, s, 'AT_HUB', patch, { type: 'REATTEMPT_REQUESTED', userId, note });
    });
  }

  /** Books a pickup for parcels waiting at the merchant when none is booked yet: today before the cutoff, else the next working day. */
  private async autoPickup(
    tx: Tx,
    merchant: { id: string; homeHubId: string },
    settings: SettingValues,
  ) {
    const clock = cairoClock(new Date());
    const open = await tx.pickup.findFirst({
      where: {
        merchantId: merchant.id,
        date: { gte: clock.date },
        status: { in: ['REQUESTED', 'ASSIGNED'] },
      },
      orderBy: { date: 'asc' },
    });
    if (open) {
      if (open.status === 'REQUESTED')
        await tx.pickup.update({
          where: { id: open.id },
          data: { expectedCount: { increment: 1 } },
        });
      return;
    }
    const weekend = settings['promise.weekend_days'];
    const beforeCutoff =
      clock.minutes < parseTime(settings['promise.cutoff']) && !weekend.includes(clock.weekday);
    const date = beforeCutoff ? clock.date : addBusinessDays(clock.date, 1, weekend);
    await tx.pickup.create({
      data: {
        code: await nextCode(tx, 'pickup_seq', 'PU'),
        merchantId: merchant.id,
        hubId: merchant.homeHubId,
        date,
        expectedCount: 1,
        auto: true,
        notes: 'Booked automatically',
      },
    });
  }

  async requestPickup(merchantId: string, input: unknown, userId: string) {
    const d = parse(PickupInput, input);
    if (d.date < todayInCairo())
      throw new DomainError('invalid_input', 'Pick a date from today on', 422);
    return this.prisma.tx(async (tx) => {
      const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
      if (!merchant.homeHubId)
        throw new DomainError(
          'no_pickup_address',
          'Add your pickup address before asking for a pickup',
          422,
        );
      const homeHubId = merchant.homeHubId;
      const open = await tx.pickup.findFirst({
        where: { merchantId, date: d.date, status: { in: ['REQUESTED', 'ASSIGNED'] } },
      });
      if (open)
        throw new DomainError('duplicate', `You already have pickup ${open.code} on that day`, 409);
      const waiting = await tx.shipment.count({
        where: { merchantId, status: 'CREATED', kind: { not: 'CUSTOMER_RETURN' } },
      });
      if (waiting === 0)
        throw new DomainError(
          'invalid_input',
          'Create your parcels first, then ask for a pickup',
          422,
        );
      const pickup = await tx.pickup.create({
        data: {
          code: await nextCode(tx, 'pickup_seq', 'PU'),
          merchantId,
          hubId: homeHubId,
          date: d.date,
          expectedCount: waiting,
          notes: d.notes,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'PICKUP_REQUESTED',
          entityType: 'pickup',
          entityId: pickup.id,
        },
      });
      return pickup;
    });
  }

  async pickups(merchantId: string) {
    return this.prisma.pickup.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async cancelPickup(merchantId: string, id: string) {
    const result = await this.prisma.pickup.updateMany({
      where: { id, merchantId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
      data: { status: 'CANCELLED' },
    });
    if (result.count !== 1)
      throw new DomainError('bad_status', 'This pickup can no longer be cancelled', 409);
  }

  async statement(merchantId: string) {
    return merchantStatement(this.prisma, merchantId);
  }
}

/** Turn a parcel around towards the merchant. Allowed until it is out with a courier. */
export async function requestReturn(
  tx: Tx,
  core: ShipmentsCore,
  s: Shipment,
  event: { type: string; userId: string; note: string },
) {
  if (s.direction === 'RETURN')
    throw new DomainError('bad_status', 'This parcel is already coming back', 409);
  if (s.status === 'CREATED')
    throw new DomainError(
      'bad_status',
      'We have not picked this parcel up yet. Cancel it instead',
      409,
    );
  if (
    ![
      'PICKED_UP',
      'AT_INBOUND',
      'SORTED',
      'AT_OUTBOUND',
      'IN_TRANSIT',
      'AT_HUB',
      'ON_HOLD',
    ].includes(s.status)
  ) {
    throw new DomainError('bad_status', 'This parcel cannot be returned now', 409);
  }
  if (s.runId)
    throw new DomainError(
      'bad_status',
      'This parcel is loaded on a courier run. Ask the hub to take it off first',
      409,
    );
  const patch: Partial<Shipment> = { direction: 'RETURN', holdReason: null };
  let to: Shipment['status'] = s.status === 'ON_HOLD' ? 'AT_HUB' : s.status;
  const here = s.currentHubId ? await tx.hub.findUnique({ where: { id: s.currentHubId } }) : null;
  if (s.status === 'SORTED') {
    // off its lane: sorting routes it again
    patch.laneHubId = null;
    to = 'AT_INBOUND';
  }
  if (s.bagId && s.status === 'AT_OUTBOUND') {
    const bag = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
    if (bag.status === 'OPEN') {
      patch.bagId = null;
      to = here?.isSorting ? 'AT_INBOUND' : 'AT_HUB';
    }
  }
  await core.move(tx, s, to, patch, { ...event, hubId: s.currentHubId });
}

/** Cash we collected for a merchant minus our fees, for parcels not yet paid out. */
export async function merchantStatement(prisma: PrismaService, merchantId: string) {
  const open = await settleable(prisma, merchantId);
  const codTotal = open.reduce((sum, s) => sum + s.codCollected, 0);
  const feesTotal = open.reduce((sum, s) => sum + feesOf(s), 0);
  const pendingCash = await prisma.shipment.aggregate({
    where: {
      merchantId,
      status: 'DELIVERED',
      payoutId: null,
      id: { notIn: open.map((s) => s.id) },
    },
    _sum: { codCollected: true },
  });
  const payouts = await prisma.payout.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const m = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  return {
    // Bank details and payouts are Shiply Now's: one payout run pays both services.
    bank: {
      bankName: m.bankName ?? '',
      accountName: m.beneficiaryName ?? '',
      iban: m.iban ? `•••• ${m.iban.slice(-4)}` : '',
      changePending: false,
      payoutSchedule: m.payoutSchedule,
    },
    shipments: open.map((s) => ({
      id: s.id,
      trackingNumber: s.trackingNumber,
      status: s.status,
      closedAt: s.closedAt,
      codCollected: s.codCollected,
      fees: feesOf(s),
    })),
    codTotal,
    feesTotal,
    balance: codTotal - feesTotal,
    cashStillWithCouriers: pendingCash._sum.codCollected ?? 0,
    payouts: payouts.map((p) => ({
      id: p.id,
      code: `PO-${p.number}`,
      amount: p.amountPiastres,
      status: p.status.toUpperCase(),
      createdAt: p.createdAt,
      paidAt: p.paidAt,
    })),
  };
}

export function feesOf(
  s: Pick<Shipment, 'status' | 'shippingFee' | 'codFee' | 'returnFee'>,
): number {
  if (s.status === 'DELIVERED') return s.shippingFee + s.codFee;
  if (s.status === 'RETURNED') return s.shippingFee + s.returnFee;
  return 0;
}

/** Closed parcels whose cash is already in a hub safe (their courier run is closed). */
export async function settleable(db: PrismaService | Tx, merchantId: string) {
  return db.shipment.findMany({
    where: {
      merchantId,
      payoutId: null,
      status: { in: ['DELIVERED', 'RETURNED'] },
      runItems: { some: { result: { in: ['DELIVERED', 'RETURNED'] }, run: { status: 'CLOSED' } } },
    },
    orderBy: { closedAt: 'asc' },
  });
}
