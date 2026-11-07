// The merchant API, version 1. LIVE keys work on real parcels through the same code as the
// merchant panel. TEST keys work on sandbox parcels that never reach the network; the sandbox
// can move a parcel through its statuses so merchants can try their webhooks.
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@shiplynow/db';
import { normalizeCode, normalizeEgyptPhone, type ParcelSize } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { nextNumber } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { presentParcel, queueParcelWebhooks } from '../common/webhooks';
import { ShipmentsCore } from '../core/shipments.core';
import { MerchantDeskService } from '../merchant/desk.service';
import { MerchantService, ShipmentInput } from '../merchant/merchant.service';
import { priceFor } from '../merchant/pricing';
import type { ApiCaller } from './api-key';

const ListQuery = z.object({
  status: z.string().trim().toUpperCase().optional(),
  createdFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** The trackingNumber of the last parcel of the previous page. */
  after: z.string().trim().max(40).optional(),
});
const Bulk = z.object({ shipments: z.array(z.unknown()).min(1).max(100) });
const Advance = z.object({ status: z.enum(['PICKED_UP', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ATTEMPT_FAILED', 'RETURNED', 'CANCELLED']) });
const SANDBOX_DONE = ['DELIVERED', 'RETURNED', 'CANCELLED'];

type SandboxEvent = { status: string; at: string; note: string };

@Injectable()
export class V1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
    private readonly merchants: MerchantService,
    private readonly desk: MerchantDeskService,
  ) {}

  private async trackingBase() {
    return (await this.settings.all())['tracking.base_url'];
  }

  async me(c: ApiCaller) {
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId }, select: { code: true, name: true } });
    return { merchant: m, mode: c.mode };
  }

  quote(c: ApiCaller, query: unknown) {
    return this.desk.quote(c.merchantId, query);
  }

  async locations() {
    const govs = await this.prisma.governorate.findMany({ include: { areas: { orderBy: { nameEn: 'asc' } } }, orderBy: { nameEn: 'asc' } });
    return govs.map((g) => ({ code: g.code, nameEn: g.nameEn, nameAr: g.nameAr, areas: g.areas.map((a) => ({ id: a.id, nameEn: a.nameEn, nameAr: a.nameAr })) }));
  }

  // ---------------------------------------------------------------- parcels

  async create(c: ApiCaller, body: unknown) {
    if (c.mode === 'TEST') return this.sandboxCreate(c, body);
    const s = await this.merchants.create(c.merchantId, body, c.userId);
    return presentParcel(s, await this.trackingBase());
  }

  /** Each parcel is created on its own, so one bad row never blocks the others. */
  async createMany(c: ApiCaller, body: unknown) {
    const { shipments } = parse(Bulk, body);
    const results: ({ index: number; ok: true; shipment: unknown } | { index: number; ok: false; error: string; message: string })[] = [];
    for (const [index, row] of shipments.entries()) {
      try {
        results.push({ index, ok: true, shipment: await this.create(c, row) });
      } catch (e) {
        results.push({ index, ok: false, error: e instanceof DomainError ? e.code : 'error', message: e instanceof DomainError ? e.message : 'Could not create this parcel' });
      }
    }
    return { created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  async list(c: ApiCaller, query: unknown) {
    const q = parse(ListQuery, query);
    const base = await this.trackingBase();
    if (c.mode === 'TEST') {
      const rows = await this.prisma.sandboxParcel.findMany({
        where: { merchantId: c.merchantId, ...(q.status ? { status: q.status } : {}), ...(q.after ? { trackingNumber: { lt: q.after } } : {}) },
        orderBy: { trackingNumber: 'desc' },
        take: q.limit,
      });
      const data = rows.map((r) => this.presentSandbox(r, base));
      return { data, next: rows.length === q.limit ? rows[rows.length - 1]!.trackingNumber : null };
    }
    const where: Prisma.ShipmentWhereInput = { merchantId: c.merchantId };
    if (q.status) where.status = q.status as never;
    if (q.createdFrom) where.createdAt = { gte: new Date(`${q.createdFrom}T00:00:00+02:00`) };
    if (q.after) where.trackingNumber = { lt: q.after.toUpperCase() };
    const rows = await this.prisma.shipment.findMany({ where, orderBy: { trackingNumber: 'desc' }, take: q.limit });
    return { data: rows.map((r) => presentParcel(r, base)), next: rows.length === q.limit ? rows[rows.length - 1]!.trackingNumber : null };
  }

  async get(c: ApiCaller, number: string) {
    const base = await this.trackingBase();
    if (c.mode === 'TEST') {
      const r = await this.prisma.sandboxParcel.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) } });
      if (!r) throw notFound('Parcel');
      return { ...this.presentSandbox(r, base), events: r.events };
    }
    const s = await this.prisma.shipment.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) } });
    if (!s) throw notFound('Parcel');
    const events = await this.prisma.shipmentEvent.findMany({ where: { shipmentId: s.id }, orderBy: { createdAt: 'asc' }, select: { type: true, toStatus: true, note: true, createdAt: true } });
    return { ...presentParcel(s, base), events: events.map((e) => ({ type: e.type, status: e.toStatus, at: e.createdAt.toISOString(), note: e.note })) };
  }

  async cancel(c: ApiCaller, number: string) {
    if (c.mode === 'TEST') return this.advance(c, number, { status: 'CANCELLED' });
    const s = await this.prisma.shipment.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) }, select: { id: true } });
    if (!s) throw notFound('Parcel');
    await this.merchants.cancel(c.merchantId, s.id, c.userId);
    return this.get(c, number);
  }

  /** What the label shows, for merchants who print their own. */
  async label(c: ApiCaller, number: string) {
    if (c.mode === 'TEST') {
      const r = await this.prisma.sandboxParcel.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) } });
      if (!r) throw notFound('Parcel');
      const i = r.input as Record<string, string | number>;
      return { trackingNumber: r.trackingNumber, barcode: 'CODE128', route: String(i.governorateCode ?? ''), customerName: i.customerName, customerPhone: i.customerPhone, address: i.address, codAmount: r.codAmount, size: i.size ?? 'M', merchantRef: r.merchantRef };
    }
    const s = await this.prisma.shipment.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) }, include: { merchant: { select: { name: true } } } });
    if (!s) throw notFound('Parcel');
    const hub = s.destinationHubId ? await this.prisma.hub.findUnique({ where: { id: s.destinationHubId }, select: { code: true } }) : null;
    return {
      trackingNumber: s.trackingNumber, barcode: 'CODE128', route: hub?.code ?? s.governorateCode, merchantName: s.merchant.name, customerName: s.customerName, customerPhone: s.customerPhone,
      address: s.address, codAmount: s.codAmount, size: s.size, allowOpen: s.allowOpen, merchantRef: s.merchantRef, description: s.description,
    };
  }

  async pickup(c: ApiCaller, body: unknown) {
    if (c.mode === 'TEST') return { code: 'TEST-PICKUP', status: 'REQUESTED', sandbox: true };
    const p = await this.merchants.requestPickup(c.merchantId, body, c.userId);
    return { code: p.code, date: p.date, status: p.status, expectedCount: p.expectedCount };
  }

  // ---------------------------------------------------------------- sandbox

  private presentSandbox(r: { trackingNumber: string; merchantRef: string; status: string; input: unknown; shippingFee: number; codAmount: number; createdAt: Date }, base: string) {
    const i = r.input as Record<string, string>;
    return {
      ...presentParcel({
        trackingNumber: r.trackingNumber, merchantRef: r.merchantRef, status: r.status, customerName: i.customerName ?? '', customerPhone: i.customerPhone ?? '', address: i.address ?? '',
        governorateCode: i.governorateCode ?? '', size: i.size ?? 'M', codAmount: r.codAmount, codCollected: r.status === 'DELIVERED' ? r.codAmount : 0, shippingFee: r.shippingFee, createdAt: r.createdAt,
      }, base),
      sandbox: true,
    };
  }

  /** Checked and priced exactly like a real parcel, then kept apart. */
  private async sandboxCreate(c: ApiCaller, body: unknown) {
    const d = parse(ShipmentInput, body);
    const phone = normalizeEgyptPhone(d.customerPhone);
    if (!phone) throw new DomainError('invalid_input', 'Customer phone must be an Egyptian mobile number', 422);
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
    const s = await this.settings.all();
    const price = await priceFor(this.prisma, this.core, s, { merchantId: c.merchantId, discountBp: m.discountBp, governorateCode: d.governorateCode, areaId: d.areaId ?? null, size: d.size as ParcelSize, allowOpen: d.allowOpen, exchange: d.exchange });
    return this.prisma.tx(async (tx) => {
      const n = await nextNumber(tx, 'sandbox_seq');
      const now = new Date().toISOString();
      const r = await tx.sandboxParcel.create({
        data: {
          merchantId: c.merchantId, trackingNumber: `TEST${String(n).padStart(9, '0')}`, merchantRef: d.merchantRef, input: { ...d, customerPhone: phone },
          shippingFee: price.shippingFee, codAmount: d.codAmount, events: [{ status: 'CREATED', at: now, note: 'Sandbox parcel' }],
        },
      });
      const view = this.presentSandbox(r, s['tracking.base_url']);
      await queueParcelWebhooks(tx, { merchantId: c.merchantId, mode: 'TEST', parcel: view, previous: null, eventType: 'CREATED' });
      return view;
    });
  }

  /** Sandbox only: moves a test parcel on, as the network would, and fires the webhooks. */
  async advance(c: ApiCaller, number: string, body: unknown) {
    if (c.mode !== 'TEST') throw new DomainError('forbidden', 'Only a TEST key can move parcels by hand', 403);
    const { status } = parse(Advance, body);
    const base = await this.trackingBase();
    return this.prisma.tx(async (tx) => {
      const r = await tx.sandboxParcel.findFirst({ where: { merchantId: c.merchantId, trackingNumber: normalizeCode(number) } });
      if (!r) throw notFound('Parcel');
      if (SANDBOX_DONE.includes(r.status)) throw new DomainError('bad_status', `This parcel is already ${r.status.toLowerCase()}`, 409);
      if (status === 'CANCELLED' && r.status !== 'CREATED') throw new DomainError('bad_status', 'Only parcels not picked up yet can be cancelled', 409);
      const events = [...(r.events as SandboxEvent[]), { status, at: new Date().toISOString(), note: 'Moved in the sandbox' }];
      const u = await tx.sandboxParcel.update({ where: { id: r.id }, data: { status, events } });
      const view = this.presentSandbox(u, base);
      await queueParcelWebhooks(tx, { merchantId: c.merchantId, mode: 'TEST', parcel: view, previous: r.status, eventType: status, note: 'Moved in the sandbox' });
      return { ...view, events };
    });
  }

  // ---------------------------------------------------------------- idempotency

  /** Runs a create once per Idempotency-Key; a repeat gets the first answer. */
  async once<T>(c: ApiCaller, key: string | undefined, run: () => Promise<T>): Promise<{ status: number; body: T | unknown; replay: boolean }> {
    if (!key) return { status: 201, body: await run(), replay: false };
    if (key.length > 100) throw new DomainError('invalid_input', 'Idempotency-Key is at most 100 characters', 422);
    const scoped = `${c.mode}:${key}`;
    const seen = await this.prisma.apiIdempotency.findUnique({ where: { merchantId_key: { merchantId: c.merchantId, key: scoped } } });
    if (seen) return { status: seen.status, body: seen.response, replay: true };
    const body = await run();
    try {
      await this.prisma.apiIdempotency.create({ data: { merchantId: c.merchantId, key: scoped, status: 201, response: body as Prisma.InputJsonValue } });
    } catch {
      /* two identical calls at once: the first one stored wins */
    }
    return { status: 201, body, replay: false };
  }
}
