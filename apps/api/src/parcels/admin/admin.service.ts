import { dbRole } from '../auth/auth';
import { onboardNewPerson } from '@shiplynow/db';
import { Injectable } from '@nestjs/common';
import { hashPassword, type Prisma, type ShipmentStatus } from '@shiplynow/db';
import { ROLES, SHIPMENT_STATUSES, TEAMS, normalizeEgyptPhone } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { onLost } from '../control/lost';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo } from '../core/shipments.core';
import { feesOf, merchantStatement, settleable } from '../merchant/merchant.service';

const SearchQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  merchantId: z.string().min(1).max(64).optional(),
  hubId: z.string().min(1).max(64).optional(),
  late: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const HubInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,10}$/, 'Use 2 to 10 letters, digits or dashes'),
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).default(''),
  isSorting: z.boolean().default(false),
  lat: z.number().min(22).max(32),
  lng: z.number().min(24).max(37),
  /** A last mile hub's sorting facility. Left empty, the nearest facility is used. */
  parentId: z.string().min(1).max(64).nullish(),
  active: z.boolean().default(true),
});

const ZoneInput = z.object({
  name: z.string().trim().min(2).max(60),
  transitDays: z.number().int().min(0).max(10),
  priceS: z.number().int().min(0),
  priceM: z.number().int().min(0),
  priceL: z.number().int().min(0),
  priceXL: z.number().int().min(0),
  priceXXL: z.number().int().min(0).optional(),
  priceBulky: z.number().int().min(0).optional(),
});

const GovernorateInput = z.object({
  zoneCode: z.string(),
  hubId: z.string().min(1).max(64).nullable(),
});
const AreaInput = z.object({
  governorateCode: z.string().min(4).max(6),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  hubId: z.string().min(1).max(64).nullable(),
});

const LineHaulInput = z.object({
  fromId: z.string().min(1).max(64),
  toId: z.string().min(1).max(64),
  bothWays: z.boolean().default(true),
  hours: z.number().int().min(1).max(240).default(12),
});
const RouteQuery = z.object({
  governorateCode: z.string().trim().min(4).max(6),
  areaId: z.string().min(1).max(64).optional(),
  merchantId: z.string().min(1).max(64).optional(),
  fromGovernorate: z.string().trim().min(4).max(6).optional(),
  fromAreaId: z.string().min(1).max(64).optional(),
});

const MerchantInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Use 2 to 10 letters or digits'),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim(),
  email: z.string().trim().email().or(z.literal('')).default(''),
  pickupAddress: z.string().trim().min(5).max(300),
  governorateCode: z.string().min(4).max(6),
  areaId: z.string().min(1).max(64).nullish(),
  discountBp: z.number().int().min(0).max(5000).default(0),
  active: z.boolean().default(true),
  flexShip: z.boolean().default(false),
});

const NextDayInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Use 2 to 10 letters or digits'),
  pickupAddress: z.string().trim().min(5).max(300),
  governorateCode: z.string().min(4).max(6),
  areaId: z.string().min(1).max(64).nullish(),
  flexShip: z.boolean().default(false),
});

const UserInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().default(''),
  role: z.enum(ROLES),
  team: z.enum(TEAMS).nullish(),
  password: z.string().min(8).max(200),
  hubId: z.string().min(1).max(64).nullish(),
  merchantId: z.string().min(1).max(64).nullish(),
});
const UserUpdate = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
  hubId: z.string().min(1).max(64).nullish(),
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
    const open: ShipmentStatus[] = [
      'CREATED',
      'PICKED_UP',
      'AT_INBOUND',
      'SORTED',
      'AT_OUTBOUND',
      'IN_TRANSIT',
      'AT_HUB',
      'ON_HOLD',
      'OUT_FOR_DELIVERY',
      'ATTEMPT_FAILED',
    ];
    const [
      byStatus,
      late,
      enteredToday,
      deliveredToday,
      failedToday,
      dueToday,
      deliveredOnTime,
      cashOut,
      tripsOut,
      hubs,
    ] = await Promise.all([
      this.prisma.shipment.groupBy({ by: ['status'], _count: true }),
      this.prisma.shipment.count({ where: { status: { in: open }, promisedDate: { lt: today } } }),
      this.prisma.shipment.count({ where: { enteredAt: { gte: startOfDay } } }),
      this.prisma.shipment.count({ where: { deliveredAt: { gte: startOfDay } } }),
      this.prisma.shipmentEvent.count({
        where: { type: 'ATTEMPT_FAILED', createdAt: { gte: startOfDay } },
      }),
      this.prisma.shipment.count({ where: { promisedDate: today } }),
      this.prisma.shipment.count({ where: { promisedDate: today, status: 'DELIVERED' } }),
      this.prisma.runItem.aggregate({
        where: { run: { status: 'OUT' } },
        _sum: { codCollected: true },
      }),
      this.prisma.trip.count({ where: { status: 'IN_TRANSIT' } }),
      this.prisma.hub.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
    ]);
    const perHub = await this.prisma.shipment.groupBy({
      by: ['currentHubId', 'status'],
      where: { status: { in: ['AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB', 'ON_HOLD'] } },
      _count: true,
    });
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
        atHub: perHub
          .filter((p) => p.currentHubId === h.id && p.status !== 'ON_HOLD')
          .reduce((n, p) => n + p._count, 0),
        onHold: perHub
          .filter((p) => p.currentHubId === h.id && p.status === 'ON_HOLD')
          .reduce((n, p) => n + p._count, 0),
      })),
    };
  }

  /** Parcels entering the network, delivered, returned and failed attempts per Cairo day. */
  async trend(daysRaw: unknown) {
    const days = Math.min(60, Math.max(7, Number(daysRaw) || 14));
    const today = todayInCairo();
    const from = new Date(`${today}T00:00:00+02:00`);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const rows = await this.prisma.$queryRaw<{ day: string; kind: string; n: bigint }[]>`
      SELECT to_char(created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day, type AS kind, count(*) AS n
      FROM shipment_events
      WHERE created_at >= ${from} AND type IN ('PICKED_UP', 'DROPPED_OFF', 'DELIVERED', 'RETURNED', 'ATTEMPT_FAILED')
      GROUP BY 1, 2`;
    const out: {
      date: string;
      entered: number;
      delivered: number;
      returned: number;
      failed: number;
    }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 864e5 + 12 * 36e5).toISOString().slice(0, 10);
      const get = (...kinds: string[]) =>
        rows
          .filter((r) => r.day === d && kinds.includes(r.kind))
          .reduce((n, r) => n + Number(r.n), 0);
      out.push({
        date: d,
        entered: get('PICKED_UP', 'DROPPED_OFF'),
        delivered: get('DELIVERED'),
        returned: get('RETURNED'),
        failed: get('ATTEMPT_FAILED'),
      });
    }
    return out;
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
      where.status = {
        in: [
          'CREATED',
          'PICKED_UP',
          'AT_INBOUND',
          'SORTED',
          'AT_OUTBOUND',
          'IN_TRANSIT',
          'AT_HUB',
          'ON_HOLD',
          'OUT_FOR_DELIVERY',
          'ATTEMPT_FAILED',
        ],
      };
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
      this.prisma.shipment.findMany({
        where,
        include: { merchant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip: (q.page - 1) * take,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: take };
  }

  async shipment(id: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        merchant: { select: { id: true, name: true, code: true, contactPhone: true } },
        events: { orderBy: { createdAt: 'asc' } },
        runItems: { include: { run: { select: { code: true, courierId: true, date: true } } } },
      },
    });
    if (!s) throw notFound('Parcel');
    const hubs = new Map((await this.prisma.hub.findMany()).map((h) => [h.id, h.code]));
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: s.events.map((e) => e.userId).filter((x): x is string => !!x) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return {
      ...s,
      hubCodes: Object.fromEntries(hubs),
      events: s.events.map((e) => ({
        ...e,
        hubCode: e.hubId ? hubs.get(e.hubId) : null,
        userName: e.userId ? users.get(e.userId) : null,
      })),
      next: await this.core.nextStep(this.prisma as never, s),
    };
  }

  async markLost(id: string, user: SessionUser, note: string) {
    return this.prisma.tx(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } });
      if (!s) throw notFound('Parcel');
      if (s.bagId) {
        const bag = await tx.bag.findUniqueOrThrow({ where: { id: s.bagId } });
        if (bag.status === 'OPEN' || bag.status === 'SEALED')
          throw new DomainError('bad_status', `Take it out of bag ${bag.code} first`, 409);
      }
      await this.core.move(
        tx,
        s,
        'LOST',
        { bagId: null, runId: null, currentHubId: null },
        { type: 'MARKED_LOST', userId: user.id, note: note.slice(0, 300) },
      );
      await onLost(tx, await this.settings.all(tx), s, user.id);
    });
  }

  // ---------------------------------------------------------------- network

  hubs() {
    return this.prisma.hub.findMany({ orderBy: [{ isSorting: 'desc' }, { code: 'asc' }] });
  }

  async saveHub(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(HubInput, body);
    const clash = await this.prisma.hub.findUnique({ where: { code: d.code } });
    if (clash && clash.id !== id)
      throw new DomainError('duplicate', `Hub code ${d.code} is taken`, 409);
    let parentId: string | null = null;
    if (!d.isSorting) {
      if (d.parentId) {
        const parent = await this.prisma.hub.findUnique({ where: { id: d.parentId } });
        if (!parent || !parent.isSorting)
          throw new DomainError(
            'invalid_input',
            'A last mile hub must be fed by a sorting facility',
            422,
          );
        parentId = parent.id;
      } else {
        parentId = (await this.core.nearestFacility(this.prisma as never, d)).id;
      }
    }
    if (id && !d.isSorting) {
      const feeds = await this.prisma.hub.count({ where: { parentId: id } });
      if (feeds > 0)
        throw new DomainError(
          'invalid_input',
          'This facility still feeds last mile hubs. Move them first',
          422,
        );
    }
    const data = {
      code: d.code,
      name: d.name,
      address: d.address,
      isSorting: d.isSorting,
      lat: d.lat,
      lng: d.lng,
      active: d.active,
      parentId,
    };
    const hub = id
      ? await this.prisma.hub.update({ where: { id }, data })
      : await this.prisma.hub.create({ data });
    await this.audit(user, id ? 'HUB_UPDATED' : 'HUB_CREATED', 'hub', hub.id, d);
    return hub;
  }

  zones() {
    return this.prisma.pricingZone.findMany({ orderBy: { transitDays: 'asc' } });
  }

  async saveZone(code: string, body: unknown, user: SessionUser) {
    const d = parse(ZoneInput, body);
    const zone = await this.prisma.pricingZone.update({ where: { code }, data: d }).catch(() => {
      throw notFound('Zone');
    });
    await this.audit(user, 'ZONE_UPDATED', 'zone', code, d);
    return zone;
  }

  // ---------------------------------------------------------------- truck routes between facilities

  async lineHauls() {
    const [links, hubs] = await Promise.all([
      this.prisma.lineHaulLink.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.hub.findMany({
        where: { isSorting: true },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const name = new Map(hubs.map((h) => [h.id, h]));
    return links.map((l) => ({
      ...l,
      from: name.get(l.fromId) ?? null,
      to: name.get(l.toId) ?? null,
    }));
  }

  /** Adds a truck route; both ways unless told otherwise. */
  async addLineHaul(body: unknown, user: SessionUser) {
    const d = parse(LineHaulInput, body);
    if (d.fromId === d.toId)
      throw new DomainError('invalid_input', 'Pick two different facilities', 422);
    const both = await this.prisma.hub.count({
      where: { id: { in: [d.fromId, d.toId] }, isSorting: true },
    });
    if (both !== 2)
      throw new DomainError('invalid_input', 'Truck routes join sorting facilities only', 422);
    const pairs = d.bothWays
      ? [
          [d.fromId, d.toId],
          [d.toId, d.fromId],
        ]
      : [[d.fromId, d.toId]];
    for (const [fromId, toId] of pairs) {
      await this.prisma.lineHaulLink.upsert({
        where: { fromId_toId: { fromId: fromId!, toId: toId! } },
        update: { active: true, hours: d.hours },
        create: { fromId: fromId!, toId: toId!, hours: d.hours },
      });
    }
    await this.audit(user, 'LINE_HAUL_SAVED', 'line_haul', d.fromId, d);
    return this.lineHauls();
  }

  async removeLineHaul(id: string, user: SessionUser) {
    const r = await this.prisma.lineHaulLink.deleteMany({ where: { id } });
    if (r.count !== 1) throw notFound('Truck route');
    await this.audit(user, 'LINE_HAUL_REMOVED', 'line_haul', id, {});
    return this.lineHauls();
  }

  /**
   * How a parcel from a merchant (or a pickup place) to an address would travel: the facility
   * that picks it up, every facility on the way, and the last mile hub. Or why we cannot carry it.
   */
  async routePreview(query: unknown) {
    const q = parse(RouteQuery, query);
    const net = await this.core.network(this.prisma as never);
    let origin: { id: string; name: string };
    let from: string;
    if (q.merchantId) {
      const m = await this.prisma.merchant.findUnique({
        where: { id: q.merchantId },
        include: { homeHub: true },
      });
      if (!m) throw notFound('Merchant');
      if (!m.homeHub || !m.governorateCode)
        return {
          ok: false,
          reason: 'This merchant has no pickup address in the network yet',
          from: m.name,
        };
      origin = m.homeHub;
      from = `${m.name}, ${m.pickupAddress}`;
      const pickup = await this.core
        .deliveryHubFor(this.prisma as never, m.governorateCode, m.areaId)
        .then(
          () => true,
          () => false,
        );
      if (!pickup)
        return { ok: false, reason: `We do not pick up from ${m.governorateCode} yet`, from };
    } else {
      const point = await this.core.pointOf(
        this.prisma as never,
        q.fromGovernorate ?? 'EG-C',
        q.fromAreaId ?? null,
      );
      origin = await this.core.nearestFacility(this.prisma as never, point);
      from = q.fromGovernorate ?? 'EG-C';
    }
    try {
      const dest = await this.core.deliveryHubFor(
        this.prisma as never,
        q.governorateCode,
        q.areaId ?? null,
      );
      const codes = await this.core.plan(
        this.prisma as never,
        'FORWARD',
        origin.id,
        dest.hubId,
        net,
      );
      const byCode = new Map([...net.values()].map((h) => [h.code, h]));
      return {
        ok: true,
        from,
        steps: codes.map((code, i) => ({
          code,
          name: byCode.get(code)?.name ?? code,
          kind: byCode.get(code)?.isSorting
            ? i === 0
              ? 'PICKUP_FACILITY'
              : 'FACILITY'
            : 'LAST_MILE',
        })),
        transfers: Math.max(0, codes.length - 3),
        zone: dest.zone.name,
        transitDays: dest.zone.transitDays,
      };
    } catch (e) {
      return { ok: false, from, reason: e instanceof DomainError ? e.message : 'No route' };
    }
  }

  /** Which governorates and areas we deliver to, in one view. */
  async coverage() {
    const govs = await this.prisma.governorate.findMany({
      include: { hub: { select: { code: true } }, areas: { select: { id: true, hubId: true } } },
      orderBy: { nameEn: 'asc' },
    });
    return govs.map((g) => ({
      code: g.code,
      nameEn: g.nameEn,
      nameAr: g.nameAr,
      served: !!g.hubId,
      hub: g.hub?.code ?? null,
      areas: g.areas.length,
      areasServed: g.areas.filter((a) => a.hubId || g.hubId).length,
    }));
  }

  governorates() {
    return this.prisma.governorate.findMany({
      include: { areas: { orderBy: { nameEn: 'asc' } } },
      orderBy: { nameEn: 'asc' },
    });
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
    const area = id
      ? await this.prisma.networkArea.update({ where: { id }, data: d })
      : await this.prisma.networkArea.create({ data: d });
    await this.audit(user, id ? 'AREA_UPDATED' : 'AREA_CREATED', 'area', area.id, d);
    return area;
  }

  private async assertLastMile(hubId: string | null) {
    if (!hubId) return;
    const hub = await this.prisma.hub.findUnique({ where: { id: hubId } });
    if (!hub || hub.isSorting)
      throw new DomainError(
        'invalid_input',
        'Addresses are delivered by a last mile hub, not a sorting facility',
        422,
      );
  }

  // ---------------------------------------------------------------- accounts

  /**
   * The network screens read active, phone and email; Shiply Now's merchant row names them
   * isActive, contactPhone and contactEmail (docs/MERGE.md), so the list answers both.
   */
  async merchants() {
    const rows = await this.prisma.merchant.findMany({
      omit: { logo: true },
      include: { homeHub: { select: { code: true } }, _count: { select: { shipments: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((m) => ({
      ...m,
      active: m.isActive,
      phone: m.contactPhone ?? '',
      email: m.contactEmail ?? '',
    }));
  }

  /** A merchant's next day setup: pickup place, facility, code, FlexShip and this month's parcels. */
  async nextDay(id: string) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      omit: { logo: true },
      include: { homeHub: { select: { id: true, code: true, name: true } } },
    });
    if (!m) throw notFound('Merchant');
    const month = new Date(`${todayInCairo().slice(0, 7)}-01T00:00:00+02:00`);
    const [parcelsThisMonth, last] = await Promise.all([
      this.prisma.shipment.count({ where: { merchantId: id, createdAt: { gte: month } } }),
      this.prisma.shipment.findFirst({
        where: { merchantId: id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      id: m.id,
      code: m.code,
      pickupAddress: m.pickupAddress,
      governorateCode: m.governorateCode,
      areaId: m.areaId,
      homeHub: m.homeHub,
      flexShip: m.flexShip,
      ready: !!(m.code && m.pickupAddress && m.governorateCode && m.homeHubId),
      parcelsThisMonth,
      lastParcelAt: last?.createdAt ?? null,
    };
  }

  /** Sets the next day setup; the pickup facility is always the nearest one (the system picks). */
  async saveNextDay(id: string, body: unknown, user: SessionUser) {
    const d = parse(NextDayInput, body);
    const before = await this.prisma.merchant.findUnique({ where: { id }, omit: { logo: true } });
    if (!before) throw notFound('Merchant');
    const clash = await this.prisma.merchant.findUnique({ where: { code: d.code } });
    if (clash && clash.id !== id)
      throw new DomainError('duplicate', `Merchant code ${d.code} is taken`, 409);
    const point = await this.core.pointOf(
      this.prisma as never,
      d.governorateCode,
      d.areaId ?? null,
    );
    const facility = await this.core.nearestFacility(this.prisma as never, point);
    const data = {
      code: d.code,
      pickupAddress: d.pickupAddress,
      governorateCode: d.governorateCode,
      areaId: d.areaId ?? null,
      flexShip: d.flexShip,
      homeHubId: facility.id,
    };
    await this.prisma.merchant.update({ where: { id }, data });
    await this.audit(user, 'MERCHANT_UPDATED', 'merchant', id, data);
    return this.nextDay(id);
  }

  async saveMerchant(id: string | null, body: unknown, user: SessionUser) {
    const d = parse(MerchantInput, body);
    const phone = normalizeEgyptPhone(d.phone);
    if (!phone)
      throw new DomainError(
        'invalid_input',
        'Merchant phone must be an Egyptian mobile number',
        422,
      );
    const clash = await this.prisma.merchant.findUnique({ where: { code: d.code } });
    if (clash && clash.id !== id)
      throw new DomainError('duplicate', `Merchant code ${d.code} is taken`, 409);
    // Pickups always go to the sorting facility nearest the merchant: the system picks it.
    const point = await this.core.pointOf(
      this.prisma as never,
      d.governorateCode,
      d.areaId ?? null,
    );
    const facility = await this.core.nearestFacility(this.prisma as never, point);
    const { phone: _phone, email, active, ...rest } = d;
    const data = {
      ...rest,
      contactPhone: phone,
      contactEmail: email || null,
      isActive: active,
      areaId: d.areaId ?? null,
      homeHubId: facility.id,
    };
    const m = id
      ? await this.prisma.merchant.update({ where: { id }, data, omit: { logo: true } })
      : await this.prisma.merchant.create({ data, omit: { logo: true } });
    await this.audit(user, id ? 'MERCHANT_UPDATED' : 'MERCHANT_CREATED', 'merchant', m.id, data);
    return m;
  }

  /** As for merchants: the screens read active, the user row names it isActive. */
  async users() {
    const rows = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        team: true,
        isActive: true,
        hubId: true,
        merchantId: true,
        hub: { select: { code: true } },
        merchant: { select: { name: true } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return rows.map((u) => ({ ...u, active: u.isActive }));
  }

  async createUser(body: unknown, user: SessionUser) {
    const d = parse(UserInput, body);
    // Office team accounts belong to Shiply Now's Users page, where their access is set.
    if (d.role === 'ADMIN')
      throw new DomainError('use_team_users', 'Make office team accounts in Settings, Users', 422);
    if ((d.role === 'HUB_STAFF' || d.role === 'COURIER') && !d.hubId)
      throw new DomainError('invalid_input', 'Hub staff and couriers need a hub', 422);
    if (d.role === 'MERCHANT' && !d.merchantId)
      throw new DomainError('invalid_input', 'Merchant users need a merchant', 422);
    if (await this.prisma.user.findUnique({ where: { email: d.email } }))
      throw new DomainError('duplicate', 'That email already has an account', 409);
    const phone = d.phone ? normalizeEgyptPhone(d.phone) : '';
    if (phone === null)
      throw new DomainError('invalid_input', 'Phone must be an Egyptian mobile number', 422);
    const created = await this.prisma.user.create({
      data: {
        email: d.email,
        name: d.name,
        phone: phone || null,
        role: dbRole(d.role),
        merchantRole: d.role === 'MERCHANT' ? 'owner' : null,
        passwordHash: await hashPassword(d.password),
        hubId: d.role === 'HUB_STAFF' || d.role === 'COURIER' ? d.hubId : null,
        team: d.role === 'HUB_STAFF' ? (d.team ?? null) : null,
        merchantId: d.role === 'MERCHANT' ? d.merchantId : null,
        // A login made by operations for a merchant is that merchant's owner.
      },
    });
    await this.audit(user, 'USER_CREATED', 'user', created.id, { email: d.email, role: d.role });
    // Hub staff and couriers have an HR file like every team member (docs/MERGE.md step 6).
    await this.prisma.$transaction((tx) => onboardNewPerson(tx, created.id, user.id));
    return { id: created.id };
  }

  async updateUser(id: string, body: unknown, user: SessionUser) {
    const d = parse(UserUpdate, body);
    if (id === user.id && d.active === false)
      throw new DomainError('invalid_input', 'You cannot deactivate your own account', 422);
    const data: Prisma.UserUpdateInput = {};
    if (d.name) data.name = d.name;
    if (d.active !== undefined) data.isActive = d.active;
    if (d.password) data.passwordHash = await hashPassword(d.password);
    if (d.hubId !== undefined)
      data.hub = d.hubId ? { connect: { id: d.hubId } } : { disconnect: true };
    if (d.team !== undefined) data.team = d.team ?? null;
    await this.prisma.user.update({ where: { id }, data }).catch(() => {
      throw notFound('User');
    });
    await this.audit(user, 'USER_UPDATED', 'user', id, {
      ...d,
      password: d.password ? 'changed' : undefined,
    });
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
      out.push({
        merchantId: m.id,
        code: m.code,
        name: m.name,
        parcels: open.length,
        codTotal: cod,
        feesTotal: fees,
        balance: cod - fees,
      });
    }
    return out;
  }

  statement(merchantId: string) {
    return merchantStatement(this.prisma, merchantId);
  }

  async courierCash() {
    const runs = await this.prisma.run.findMany({
      where: { status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      take: 200,
    });
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { role: 'courier' },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
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

  private audit(
    user: SessionUser,
    action: string,
    entity: string,
    entityId: string,
    data: unknown,
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action,
        entityType: entity,
        entityId,
        after: JSON.parse(JSON.stringify(data ?? {})),
      },
    });
  }
}
