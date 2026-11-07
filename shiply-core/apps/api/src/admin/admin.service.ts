import { Injectable } from '@nestjs/common';
import { hashPassword, type Prisma, type ShipmentStatus } from '@shiply/db';
import { ROLES, SHIPMENT_STATUSES, TEAMS, normalizeEgyptPhone } from '@shiply/shared';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo } from '../core/shipments.core';
import { feesOf, merchantStatement, settleable } from '../merchant/merchant.service';

const SearchQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  merchantId: z.string().uuid().optional(),
  hubId: z.string().uuid().optional(),
  late: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const HubInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,10}$/, 'Use 2 to 10 letters, digits or dashes'),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).default(''),
  isSorting: z.boolean().default(false),
  lat: z.number().min(22).max(32),
  lng: z.number().min(24).max(37),
  /** A last mile hub's sorting facility. Left empty, the nearest facility is used. */
  parentId: z.string().uuid().nullish(),
  active: z.boolean().default(true),
});

const ZoneInput = z.object({
  name: z.string().trim().min(2).max(60),
  transitDays: z.number().int().min(0).max(10),
  priceS: z.number().int().min(0),
  priceM: z.number().int().min(0),
  priceL: z.number().int().min(0),
  priceXL: z.number().int().min(0),
});

const GovernorateInput = z.object({ zoneCode: z.string(), hubId: z.string().uuid().nullable() });
const AreaInput = z.object({
  governorateCode: z.string().length(3),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  hubId: z.string().uuid().nullable(),
});

const MerchantInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/, 'Use 2 to 10 letters or digits'),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim(),
  email: z.string().trim().email().or(z.literal('')).default(''),
  pickupAddress: z.string().trim().min(5).max(300),
  governorateCode: z.string().length(3),
  areaId: z.string().uuid().nullish(),
  discountBp: z.number().int().min(0).max(5000).default(0),
  active: z.boolean().default(true),
});

const UserInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().default(''),
  role: z.enum(ROLES),
  team: z.enum(TEAMS).nullish(),
  password: z.string().min(8).max(200),
  hubId: z.string().uuid().nullish(),
  merchantId: z.string().uuid().nullish(),
});
const UserUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  hubId: z.string().uuid().nullish(),
  team: z.enum(TEAMS).nullish(),
});

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  // ---------------------------------------------------------------- dashboard

  async dashboard() {
    const today = todayInCairo();
    const startOfDay = new Date(`${today}T00:00:00+02:00`);
    const open: ShipmentStatus[] = ['CREATED', 'PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'ON_HOLD', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED'];
    const [byStatus, late, enteredToday, deliveredToday, failedToday, dueToday, deliveredOnTime, cashOut, tripsOut, hubs] = await Promise.all([
      this.prisma.shipment.groupBy({ by: ['status'], _count: true }),
      this.prisma.shipment.count({ where: { status: { in: open }, promisedDate: { lt: today } } }),
      this.prisma.shipment.count({ where: { enteredAt: { gte: startOfDay } } }),
      this.prisma.shipment.count({ where: { deliveredAt: { gte: startOfDay } } }),
      this.prisma.shipmentEvent.count({ where: { type: 'ATTEMPT_FAILED', createdAt: { gte: startOfDay } } }),
      this.prisma.shipment.count({ where: { promisedDate: today } }),
      this.prisma.shipment.count({ where: { promisedDate: today, status: 'DELIVERED' } }),
      this.prisma.runItem.aggregate({ where: { run: { status: 'OUT' } }, _sum: { codCollected: true } }),
      this.prisma.trip.count({ where: { status: 'IN_TRANSIT' } }),
      this.prisma.hub.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    ]);
    const perHub = await this.prisma.shipment.groupBy({ by: ['currentHubId', 'status'], where: { status: { in: ['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB', 'ON_HOLD'] } }, _count: true });
    return {
      today,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      late,
      enteredToday,
      deliveredToday,
      failedToday,
      dueToday,
      deliveredOnTime,
      cashWithCouriers: cashOut._sum.codCollected ?? 0,
      tripsOnTheRoad: tripsOut,
      hubs: hubs.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        isSorting: h.isSorting,
        parentId: h.parentId,
        atHub: perHub.filter((p) => p.currentHubId === h.id && p.status !== 'ON_HOLD').reduce((n, p) => n + p._count, 0),
        onHold: perHub.filter((p) => p.currentHubId === h.id && p.status === 'ON_HOLD').reduce((n, p) => n + p._count, 0),
      })),
    };
  }

  // ---------------------------------------------------------------- parcels

  async search(query: unknown) {
    const q = parse(SearchQuery, query);
    const where: Prisma.ShipmentWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.merchantId) where.merchantId = q.merchantId;
    if (q.hubId) where.currentHubId = q.hubId;
    if (q.late) {
      where.promisedDate = { lt: todayInCairo() };
      where.status = { in: ['CREATED', 'PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'IN_TRANSIT', 'AT_HUB', 'ON_HOLD', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED'] };
    }
    if (q.q) {
      where.OR = [
        { trackingNumber: { contains: q.q.toUpperCase() } },
        { customerName: { contains: q.q, mode: 'insensitive' } },
        { customerPhone: { contains: q.q.replace(/^0/, '') } },
        { merchantRef: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const take = 50;
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({ where, include: { merchant: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take, skip: (q.page - 1) * take }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: take };
  }

  async shipment(id: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        merchant: { select: { id: true, name: true, code: true, phone: true } },
        events: { orderBy: { createdAt: 'asc' } },
        runItems: { include: { run: { select: { code: true, courierId: true, date: true } } } },
      },
    });
    if (!s) throw notFound('Parcel');
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h.code]));
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: s.events.map((e) => e.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    return {
      ...s,
      hubCodes: Object.fromEntries(hubs),
      events: s.events.map((e) => ({ ...e, hubCode: e.hubId ? hubs.get(e.hubId) : null, userName: e.userId ? users.get(e.userId) : null })),
      next: await this.core.nextStep(this.prisma as never, s),
    };
  }

  async markLost(id: string, user: SessionUser, note: string) {
    return this.prisma.tx(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } });
      if (!s) throw notFound('Parcel');
      if (s.bagId) {
        const bag = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
        if (bag.status === 'OPEN' || bag.status === 'SEALED') throw new DomainError('bad_status', `Take it out of bag ${bag.code} first`, 409);
      }
      await this.core.move(tx, s, 'LOST', { bagId: null, runId: null, currentHubId: null }, { type: 'MARKED_LOST', userId: user.id, note: note.slice(0, 300) });
    });
  }

  // ---------------------------------------------------------------- network

  hubs() {
    return this.prisma.hub.findMany({ orderBy: [{ isSorting: 'desc' }, { code: 'asc' }] });
  }

  async saveHub(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(HubInput, body);
    const clash = await this.prisma.hub.findUnique({ where: { code: d.code } });
    if (clash && clash.id !== id) throw new DomainError('duplicate', `Hub code ${d.code} is taken`, 409);
    let parentId: string | null = null;
    if (!d.isSorting) {
      if (d.parentId) {
        const parent = await this.prisma.hub.findUnique({ where: { id: d.parentId } });
        if (!parent || !parent.isSorting) throw new DomainError('invalid_input', 'A last mile hub must be fed by a sorting facility', 422);
        parentId = parent.id;
      } else {
        parentId = (await this.core.nearestFacility(this.prisma as never, d)).id;
      }
    }
    if (id && !d.isSorting) {
      const feeds = await this.prisma.hub.count({ where: { parentId: id } });
      if (feeds > 0) throw new DomainError('invalid_input', 'This facility still feeds last mile hubs. Move them first', 422);
    }
    const data = { code: d.code, name: d.name, address: d.address, isSorting: d.isSorting, lat: d.lat, lng: d.lng, active: d.active, parentId };
    const hub = id ? await this.prisma.hub.update({ where: { id }, data }) : await this.prisma.hub.create({ data });
    await this.audit(user, id ? 'HUB_UPDATED' : 'HUB_CREATED', 'hub', hub.id, d);
    return hub;
  }

  zones() {
    return this.prisma.zone.findMany({ orderBy: { transitDays: 'asc' } });
  }

  async saveZone(code: string, body: unknown, user: SessionUser) {
    const d = parse(ZoneInput, body);
    const zone = await this.prisma.zone.update({ where: { code }, data: d }).catch(() => {
      throw notFound('Zone');
    });
    await this.audit(user, 'ZONE_UPDATED', 'zone', code, d);
    return zone;
  }

  governorates() {
    return this.prisma.governorate.findMany({ include: { areas: { orderBy: { nameEn: 'asc' } } }, orderBy: { nameEn: 'asc' } });
  }

  async saveGovernorate(code: string, body: unknown, user: SessionUser) {
    const d = parse(GovernorateInput, body);
    await this.assertLastMile(d.hubId);
    const gov = await this.prisma.governorate.update({ where: { code }, data: d }).catch(() => {
      throw new DomainError('invalid_input', 'Unknown governorate, zone or hub', 422);
    });
    await this.audit(user, 'GOVERNORATE_UPDATED', 'governorate', code, d);
    return gov;
  }

  async saveArea(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(AreaInput, body);
    await this.assertLastMile(d.hubId);
    const area = id ? await this.prisma.area.update({ where: { id }, data: d }) : await this.prisma.area.create({ data: d });
    await this.audit(user, id ? 'AREA_UPDATED' : 'AREA_CREATED', 'area', area.id, d);
    return area;
  }

  private async assertLastMile(hubId: string | null) {
    if (!hubId) return;
    const hub = await this.prisma.hub.findUnique({ where: { id: hubId } });
    if (!hub || hub.isSorting) throw new DomainError('invalid_input', 'Addresses are delivered by a last mile hub, not a sorting facility', 422);
  }

  // ---------------------------------------------------------------- accounts

  merchants() {
    return this.prisma.merchant.findMany({ include: { homeHub: { select: { code: true } }, _count: { select: { shipments: true } } }, orderBy: { name: 'asc' } });
  }

  async saveMerchant(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(MerchantInput, body);
    const phone = normalizeEgyptPhone(d.phone);
    if (!phone) throw new DomainError('invalid_input', 'Merchant phone must be an Egyptian mobile number', 422);
    const clash = await this.prisma.merchant.findUnique({ where: { code: d.code } });
    if (clash && clash.id !== id) throw new DomainError('duplicate', `Merchant code ${d.code} is taken`, 409);
    // Pickups always go to the sorting facility nearest the merchant: the system picks it.
    const point = await this.core.pointOf(this.prisma as never, d.governorateCode, d.areaId ?? null);
    const facility = await this.core.nearestFacility(this.prisma as never, point);
    const data = { ...d, phone, areaId: d.areaId ?? null, homeHubId: facility.id };
    const m = id ? await this.prisma.merchant.update({ where: { id }, data }) : await this.prisma.merchant.create({ data });
    await this.audit(user, id ? 'MERCHANT_UPDATED' : 'MERCHANT_CREATED', 'merchant', m.id, data);
    return m;
  }

  users() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true, phone: true, role: true, team: true, active: true, hubId: true, merchantId: true, hub: { select: { code: true } }, merchant: { select: { name: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async createUser(body: unknown, user: SessionUser) {
    const d = parse(UserInput, body);
    if ((d.role === 'HUB_STAFF' || d.role === 'COURIER') && !d.hubId) throw new DomainError('invalid_input', 'Hub staff and couriers need a hub', 422);
    if (d.role === 'MERCHANT' && !d.merchantId) throw new DomainError('invalid_input', 'Merchant users need a merchant', 422);
    if (await this.prisma.user.findUnique({ where: { email: d.email } })) throw new DomainError('duplicate', 'That email already has an account', 409);
    const phone = d.phone ? normalizeEgyptPhone(d.phone) : '';
    if (phone === null) throw new DomainError('invalid_input', 'Phone must be an Egyptian mobile number', 422);
    const created = await this.prisma.user.create({
      data: {
        email: d.email,
        name: d.name,
        phone,
        role: d.role,
        passwordHash: await hashPassword(d.password),
        hubId: d.role === 'HUB_STAFF' || d.role === 'COURIER' ? d.hubId : null,
        team: d.role === 'HUB_STAFF' ? (d.team ?? null) : null,
        merchantId: d.role === 'MERCHANT' ? d.merchantId : null,
      },
    });
    await this.audit(user, 'USER_CREATED', 'user', created.id, { email: d.email, role: d.role });
    return { id: created.id };
  }

  async updateUser(id: string, body: unknown, user: SessionUser) {
    const d = parse(UserUpdate, body);
    if (id === user.id && d.active === false) throw new DomainError('invalid_input', 'You cannot deactivate your own account', 422);
    const data: Prisma.UserUpdateInput = {};
    if (d.name) data.name = d.name;
    if (d.active !== undefined) data.active = d.active;
    if (d.password) data.passwordHash = await hashPassword(d.password);
    if (d.hubId !== undefined) data.hub = d.hubId ? { connect: { id: d.hubId } } : { disconnect: true };
    if (d.team !== undefined) data.team = d.team ?? null;
    await this.prisma.user.update({ where: { id }, data }).catch(() => {
      throw notFound('User');
    });
    await this.audit(user, 'USER_UPDATED', 'user', id, { ...d, password: d.password ? 'changed' : undefined });
  }

  // ---------------------------------------------------------------- settings

  settingsAll() {
    return this.settings.all();
  }

  async saveSetting(key: string, value: unknown, user: SessionUser) {
    await this.settings.update(key, value);
    await this.audit(user, 'SETTING_UPDATED', 'setting', key, { value });
  }

  // ---------------------------------------------------------------- money

  async balances() {
    const merchants = await this.prisma.merchant.findMany({ orderBy: { name: 'asc' } });
    const out = [];
    for (const m of merchants) {
      const open = await settleable(this.prisma, m.id);
      const cod = open.reduce((n, s) => n + s.codCollected, 0);
      const fees = open.reduce((n, s) => n + feesOf(s), 0);
      out.push({ merchantId: m.id, code: m.code, name: m.name, parcels: open.length, codTotal: cod, feesTotal: fees, balance: cod - fees });
    }
    return out;
  }

  statement(merchantId: string) {
    return merchantStatement(this.prisma, merchantId);
  }

  /** Settle everything that is ready for one merchant. The bank transfer itself is done outside. */
  async createPayout(merchantId: string, reference: string, user: SessionUser) {
    return this.prisma.tx(async (tx) => {
      const open = await settleable(tx, merchantId);
      if (open.length === 0) throw new DomainError('invalid_input', 'Nothing to settle for this merchant yet', 422);
      const codTotal = open.reduce((n, s) => n + s.codCollected, 0);
      const feesTotal = open.reduce((n, s) => n + feesOf(s), 0);
      const payout = await tx.payout.create({
        data: { code: await nextCode(tx, 'payout_seq', 'PO'), merchantId, codTotal, feesTotal, amount: codTotal - feesTotal, reference: reference.slice(0, 120), createdById: user.id },
      });
      const r = await tx.shipment.updateMany({ where: { id: { in: open.map((s) => s.id) }, payoutId: null }, data: { payoutId: payout.id } });
      if (r.count !== open.length) throw new DomainError('conflict', 'Someone settled some of these parcels just now. Try again', 409);
      await this.audit(user, 'PAYOUT_CREATED', 'payout', payout.id, { merchantId, amount: payout.amount, parcels: open.length });
      return payout;
    });
  }

  payouts() {
    return this.prisma.payout.findMany({ include: { merchant: { select: { name: true } }, _count: { select: { shipments: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async courierCash() {
    const runs = await this.prisma.run.findMany({ where: { status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, take: 200 });
    const users = new Map((await this.prisma.user.findMany({ where: { role: 'COURIER' }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h.code]));
    return runs.map((r) => ({
      id: r.id,
      code: r.code,
      date: r.date,
      courier: users.get(r.courierId) ?? '',
      hub: hubs.get(r.hubId) ?? '',
      expected: r.cashExpected,
      received: r.cashReceived ?? 0,
      difference: (r.cashReceived ?? 0) - r.cashExpected,
    }));
  }

  private audit(user: SessionUser, action: string, entity: string, entityId: string, data: unknown) {
    return this.prisma.auditLog.create({ data: { userId: user.id, action, entity, entityId, data: JSON.parse(JSON.stringify(data ?? {})) } });
  }
}
