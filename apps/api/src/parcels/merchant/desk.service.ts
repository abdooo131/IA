import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hashPassword, leadFromSignup } from '@shiplynow/db';
import {
  PARCEL_SIZES,
  cairoClock,
  nearest,
  normalizeCode,
  normalizeEgyptPhone,
  splitVat,
  type ParcelSize,
} from '@shiplynow/shared/parcels';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { openAlert } from '../agents/alerts';
import type { SessionUser } from '../auth/auth';
import { DomainError, notFound } from '../common/errors';
import { queueMessage, queueParcelMessage } from '../common/messages';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore, todayInCairo } from '../core/shipments.core';
import { MerchantService } from './merchant.service';
import { priceFor, tierFor } from './pricing';

export const RIGHTS = ['orders', 'pickups', 'money', 'settings'] as const;
export type Right = (typeof RIGHTS)[number];

const PHONE = z.string().trim().min(8).max(20);
const OTP_MINUTES = 10;

const CodeRequest = z.object({ phone: PHONE });
const SignupInput = z.object({
  phone: PHONE,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6 digit code'),
  businessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  pickupAddress: z.string().trim().min(5).max(300),
  governorateCode: z.string().trim().min(4).max(6),
  areaId: z.string().min(1).max(64).nullish(),
  taxId: z.string().trim().max(30).default(''),
});
const TeamInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(20).default(''),
  password: z.string().min(8).max(200).optional(),
  rights: z.array(z.enum(RIGHTS)).min(1, 'Give at least one right'),
  active: z.boolean().default(true),
});
const LogoInput = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  dataBase64: z.string().min(8),
});
const RecurringInput = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  active: z.boolean().default(true),
  notes: z.string().trim().max(300).default(''),
});
const QuoteInput = z.object({
  governorateCode: z.string().trim().min(4).max(6),
  areaId: z.string().min(1).max(64).nullish(),
  size: z.enum(PARCEL_SIZES).default('M'),
  allowOpen: z.coerce.boolean().default(false),
  exchange: z.coerce.boolean().default(false),
});
const TierInput = z.object({
  tiers: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        minParcels: z.number().int().min(0),
        discountBp: z.number().int().min(0).max(5000),
      }),
    )
    .min(1)
    .max(20),
});
const PricesInput = z.object({
  prices: z
    .array(
      z.object({
        zoneCode: z.string(),
        size: z.enum(PARCEL_SIZES),
        price: z.number().int().min(0).nullable(),
      }),
    )
    .max(200),
});
const ActionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CONFIRM'),
    phoneLast4: z.string().regex(/^\d{4}$/),
    note: z.string().trim().max(300).default(''),
  }),
  z.object({
    action: z.literal('POSTPONE'),
    phoneLast4: z.string().regex(/^\d{4}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(300).default(''),
  }),
  z.object({
    action: z.literal('CANCEL'),
    phoneLast4: z.string().regex(/^\d{4}$/),
    note: z.string().trim().max(300).default(''),
  }),
  z.object({
    action: z.literal('RATE'),
    phoneLast4: z.string().regex(/^\d{4}$/),
    rating: z.number().int().min(1).max(5),
    note: z.string().trim().max(300).default(''),
  }),
]);

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** The merchant's side beyond parcels: sign up, team, logo, prices, recurring pickups, analytics; and the customer's actions. */
@Injectable()
export class MerchantDeskService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
    private readonly merchants: MerchantService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(() => {
      void this.createRecurringPickups().catch((e) => console.error('recurring pickups', e));
      void this.sendQueued().catch((e) => console.error('messages', e));
    }, 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- sign up with a code

  /** Sends a 6 digit code to the phone. At most 3 codes an hour per phone. */
  async requestCode(body: unknown) {
    const { phone: raw } = parse(CodeRequest, body);
    const phone = normalizeEgyptPhone(raw);
    if (!phone) throw new DomainError('invalid_input', 'Use an Egyptian mobile number', 422);
    const recent = await this.prisma.otpCode.count({
      where: { phone, purpose: 'SIGNUP', createdAt: { gte: new Date(Date.now() - 3600e3) } },
    });
    if (recent >= 3) throw new DomainError('too_many', 'Too many codes. Try again in an hour', 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        phone,
        purpose: 'SIGNUP',
        codeHash: hash(code),
        expiresAt: new Date(Date.now() + OTP_MINUTES * 60e3),
      },
    });
    await queueMessage(this.prisma, { to: phone, template: 'OTP', vars: { code } });
    return { sent: true, expiresInMinutes: OTP_MINUTES };
  }

  private async useCode(tx: Tx, phone: string, code: string) {
    const otp = await tx.otpCode.findFirst({
      where: { phone, purpose: 'SIGNUP', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new DomainError('bad_code', 'The code expired. Ask for a new one', 422);
    if (otp.attempts >= 5)
      throw new DomainError('bad_code', 'Too many wrong tries. Ask for a new code', 422);
    const ok = timingSafeEqual(Buffer.from(otp.codeHash), Buffer.from(hash(code)));
    if (!ok) {
      await tx.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new DomainError('bad_code', 'Wrong code', 422);
    }
    await tx.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  }

  /** A business signs itself up; it waits for operations to approve it. */
  async signup(body: unknown) {
    const d = parse(SignupInput, body);
    const phone = normalizeEgyptPhone(d.phone);
    if (!phone) throw new DomainError('invalid_input', 'Use an Egyptian mobile number', 422);
    if (await this.prisma.user.findUnique({ where: { email: d.email } }))
      throw new DomainError('duplicate', 'That email already has an account. Sign in instead', 409);
    const gov = await this.prisma.governorate.findUnique({ where: { code: d.governorateCode } });
    if (!gov) throw new DomainError('invalid_input', 'Unknown governorate', 422);
    const area = d.areaId
      ? await this.prisma.networkArea.findUnique({ where: { id: d.areaId } })
      : null;
    const facilities = await this.prisma.hub.findMany({ where: { isSorting: true, active: true } });
    const at =
      area?.lat != null ? { lat: area.lat, lng: area.lng! } : { lat: gov.lat!, lng: gov.lng! };
    const home = nearest(
      at,
      facilities.filter((f) => f.lat != null).map((f) => ({ ...f, lat: f.lat!, lng: f.lng! })),
    );
    if (!home) throw new DomainError('not_served', 'We have no pickup facility yet', 422);
    const passwordHash = await hashPassword(d.password);
    return this.prisma.tx(async (tx) => {
      await this.useCode(tx, phone, d.code);
      const base =
        d.businessName
          .replace(/[^A-Za-z]/g, '')
          .toUpperCase()
          .slice(0, 4) || 'MRC';
      let code = base;
      for (let i = 2; await tx.merchant.findUnique({ where: { code } }); i++) code = `${base}${i}`;
      const m = await tx.merchant.create({
        data: {
          code,
          name: d.businessName,
          contactName: d.contactName,
          contactPhone: phone,
          contactEmail: d.email,
          pickupAddress: d.pickupAddress,
          governorateCode: d.governorateCode,
          areaId: d.areaId ?? null,
          homeHubId: home.id,
          taxRegistrationNumber: d.taxId,
          approval: 'pending',
          isActive: false,
        },
      });
      await tx.user.create({
        data: {
          email: d.email,
          name: d.contactName,
          phone,
          role: 'merchant',
          merchantId: m.id,
          merchantRole: 'owner',
          isActive: false,
          passwordHash,
        },
      });
      // Sales follows every sign up as a lead, whichever service it came from (docs/SALES.md).
      await leadFromSignup(tx, {
        merchantId: m.id,
        businessName: d.businessName,
        contactName: d.contactName,
        email: d.email,
        phone,
      });
      await openAlert(tx, {
        kind: 'MERCHANT_SIGNUP',
        entity: 'merchant',
        entityId: m.id,
        message: `${d.businessName} signed up and waits for approval`,
      });
      return { id: m.id, message: 'Thank you. We will call you and switch on your account' };
    });
  }

  async decideSignup(merchantId: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const m = await tx.merchant.findUnique({ where: { id: merchantId } });
      if (!m || m.approval !== 'pending')
        throw new DomainError('bad_status', 'This merchant is not waiting for approval', 409);
      await tx.merchant.update({
        where: { id: merchantId },
        data: { approval: approve ? 'approved' : 'rejected', isActive: approve },
      });
      await tx.user.updateMany({ where: { merchantId }, data: { isActive: approve } });
      await tx.networkAlert.updateMany({
        where: { entity: 'merchant', entityId: merchantId, status: 'OPEN' },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedById: user.id,
          note: approve ? 'Approved' : 'Rejected',
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: approve ? 'MERCHANT_APPROVED' : 'MERCHANT_REJECTED',
          entityType: 'merchant',
          entityId: merchantId,
        },
      });
    });
  }

  pendingSignups() {
    return this.prisma.merchant.findMany({
      where: { approval: 'pending' },
      omit: { logo: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------- team

  async team(merchantId: string) {
    const rows = await this.prisma.user.findMany({
      where: { merchantId, role: 'merchant' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        merchantRole: true,
        merchantRights: true,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ merchantRole, isActive, ...r }) => ({
      ...r,
      merchantOwner: merchantRole === 'owner',
      active: isActive,
    }));
  }

  async saveTeamMember(merchantId: string, id: string | null, body: unknown, user: SessionUser) {
    const d = parse(TeamInput, body);
    if (id) {
      const u = await this.prisma.user.findFirst({ where: { id, merchantId, role: 'merchant' } });
      if (!u) throw notFound('Team member');
      if (u.merchantRole === 'owner')
        throw new DomainError('forbidden', 'The owner always has every right', 403);
      await this.prisma.user.update({
        where: { id },
        data: {
          name: d.name,
          phone: d.phone || null,
          merchantRights: d.rights,
          isActive: d.active,
          ...(d.password ? { passwordHash: await hashPassword(d.password) } : {}),
        },
      });
      return { id };
    }
    if (!d.password)
      throw new DomainError('invalid_input', 'Set a password of 8 characters or more', 422);
    if (await this.prisma.user.findUnique({ where: { email: d.email } }))
      throw new DomainError('duplicate', 'That email already has an account', 409);
    const u = await this.prisma.user
      .create({
        data: {
          email: d.email,
          name: d.name,
          phone: d.phone || null,
          role: 'merchant',
          merchantId,
          merchantRole: 'member',
          merchantRights: d.rights,
          isActive: d.active,
          passwordHash: await hashPassword(d.password),
        },
      })
      .then((u) => u);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'MERCHANT_TEAM_ADDED',
        entityType: 'user',
        entityId: u.id,
        after: { rights: d.rights },
      },
    });
    return { id: u.id };
  }

  // ---------------------------------------------------------------- logo, recurring pickups

  async setLogo(merchantId: string, body: unknown) {
    const d = parse(LogoInput, body);
    const clean = d.dataBase64.includes(',')
      ? d.dataBase64.slice(d.dataBase64.indexOf(',') + 1)
      : d.dataBase64;
    const buf = Buffer.from(clean, 'base64');
    if (buf.length === 0 || buf.length > 500 * 1024)
      throw new DomainError('invalid_input', 'The logo must be under 500 KB', 422);
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { logo: new Uint8Array(buf), logoMime: d.mime },
    });
  }

  async logoForParcel(trackingNumber: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { trackingNumber: normalizeCode(trackingNumber) },
      select: { merchant: { select: { logo: true, logoMime: true } } },
    });
    if (!s?.merchant.logo) throw notFound('Logo');
    return { data: s.merchant.logo, mime: s.merchant.logoMime, name: 'logo' };
  }

  recurring(merchantId: string) {
    return this.prisma.recurringPickup.findUnique({ where: { merchantId } });
  }

  async saveRecurring(merchantId: string, body: unknown) {
    const d = parse(RecurringInput, body);
    const weekdays = [...new Set(d.weekdays)].sort();
    return this.prisma.recurringPickup.upsert({
      where: { merchantId },
      update: { ...d, weekdays },
      create: { merchantId, ...d, weekdays },
    });
  }

  /** Each morning: a pickup for every merchant whose recurring day is today and who has parcels waiting. */
  async createRecurringPickups(at = new Date()) {
    const { date, weekday } = cairoClock(at);
    const due = await this.prisma.recurringPickup.findMany({
      where: {
        active: true,
        weekdays: { has: weekday },
        OR: [{ lastCreatedFor: null }, { lastCreatedFor: { not: date } }],
      },
    });
    let made = 0;
    for (const r of due) {
      await this.prisma.recurringPickup.update({
        where: { id: r.id },
        data: { lastCreatedFor: date },
      });
      const owner = await this.prisma.user.findFirst({
        where: { merchantId: r.merchantId, merchantRole: 'owner' },
      });
      try {
        await this.merchants.requestPickup(
          r.merchantId,
          { date, notes: r.notes || 'Recurring pickup' },
          owner?.id ?? r.merchantId,
        );
        made++;
      } catch {
        // Nothing waiting, or a pickup already booked for today: nothing to do.
      }
    }
    return made;
  }

  // ---------------------------------------------------------------- prices

  async quote(merchantId: string, query: unknown) {
    const d = parse(QuoteInput, query);
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    // The same checks as creating a parcel, so a merchant never sees a price for a parcel we
    // would then refuse: a pickup address, in an area we pick up from.
    if (!m.homeHubId || !m.governorateCode)
      throw new DomainError(
        'no_pickup_address',
        'Add your pickup address before sending parcels',
        422,
      );
    await this.core.deliveryHubFor(this.prisma as never, m.governorateCode, m.areaId).catch(() => {
      throw new DomainError('not_served', 'We do not pick up from your area yet', 422);
    });
    const s = await this.settings.all();
    const p = await priceFor(this.prisma, this.core, s, {
      merchantId,
      discountBp: m.discountBp,
      governorateCode: d.governorateCode,
      areaId: d.areaId ?? null,
      size: d.size as ParcelSize,
      allowOpen: d.allowOpen,
      exchange: d.exchange,
    });
    const vat = splitVat(p.shippingFee, s['tax.vat_bp']);
    return {
      zone: p.zone.name,
      basePrice: p.basePrice,
      discount: p.discount,
      openFee: p.openFee,
      exchangeFee: p.exchangeFee,
      shippingFee: p.shippingFee,
      vatIncluded: vat.vat,
      agreed: p.agreed,
      transitDays: p.zone.transitDays,
    };
  }

  /** The merchant's own price list: every zone and size, after their agreed prices, discount or tier. */
  async priceList(merchantId: string) {
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    const [zones, agreed, tier] = await Promise.all([
      this.prisma.pricingZone.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.merchantPrice.findMany({ where: { merchantId } }),
      tierFor(this.prisma, merchantId),
    ]);
    const discountBp = m.discountBp > 0 ? m.discountBp : (tier.tier?.discountBp ?? 0);
    const list = {
      S: 'priceS',
      M: 'priceM',
      L: 'priceL',
      XL: 'priceXL',
      XXL: 'priceXXL',
      BULKY: 'priceBulky',
    } as const;
    return {
      tier: tier.tier,
      lastMonthParcels: tier.lastMonthParcels,
      discountBp,
      ownDiscount: m.discountBp > 0,
      tiers: await this.prisma.priceTier.findMany({ orderBy: { minParcels: 'asc' } }),
      zones: zones.map((z) => ({
        code: z.code,
        name: z.name,
        transitDays: z.transitDays,
        prices: Object.fromEntries(
          PARCEL_SIZES.map((size) => {
            const a = agreed.find((x) => x.zoneCode === z.code && x.size === size);
            const base = z[list[size]];
            return [
              size,
              {
                list: base,
                price: a ? a.price : base - Math.floor((base * discountBp + 5000) / 10000),
                agreed: !!a,
              },
            ];
          }),
        ),
      })),
    };
  }

  tiers() {
    return this.prisma.priceTier.findMany({ orderBy: { minParcels: 'asc' } });
  }

  async saveTiers(body: unknown, user: SessionUser) {
    const { tiers } = parse(TierInput, body);
    if (!tiers.some((t) => t.minParcels === 0))
      throw new DomainError('invalid_input', 'One tier must start at 0 parcels', 422);
    await this.prisma.$transaction([
      this.prisma.priceTier.deleteMany({}),
      this.prisma.priceTier.createMany({ data: tiers }),
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'PRICE_TIERS_SAVED',
        entityType: 'price_tier',
        entityId: 'all',
        after: { tiers },
      },
    });
  }

  merchantPrices(merchantId: string) {
    return this.prisma.merchantPrice.findMany({ where: { merchantId } });
  }

  /** Agreed prices for one merchant; a null price removes the agreement for that zone and size. */
  async saveMerchantPrices(merchantId: string, body: unknown, user: SessionUser) {
    const { prices } = parse(PricesInput, body);
    await this.prisma.$transaction(
      prices.map((p) =>
        p.price === null
          ? this.prisma.merchantPrice.deleteMany({
              where: { merchantId, zoneCode: p.zoneCode, size: p.size },
            })
          : this.prisma.merchantPrice.upsert({
              where: {
                merchantId_zoneCode_size: { merchantId, zoneCode: p.zoneCode, size: p.size },
              },
              update: { price: p.price },
              create: { merchantId, zoneCode: p.zoneCode, size: p.size, price: p.price },
            }),
      ),
    );
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'MERCHANT_PRICES_SAVED',
        entityType: 'merchant',
        entityId: merchantId,
        after: { prices },
      },
    });
  }

  // ---------------------------------------------------------------- analytics

  async analytics(merchantId: string, daysQ?: string) {
    const days = Math.min(90, Math.max(7, Number(daysQ) || 30));
    const since = new Date(Date.now() - days * 86400e3);
    const s = await this.settings.all();
    const parcels = await this.prisma.shipment.findMany({
      where: { merchantId, createdAt: { gte: since }, kind: { not: 'EXCHANGE_RETURN' } },
      select: {
        status: true,
        shippingFee: true,
        codFee: true,
        returnFee: true,
        codCollected: true,
        attempts: true,
        lastFailReason: true,
        createdAt: true,
        deliveredAt: true,
        closedAt: true,
      },
    });
    const delivered = parcels.filter((p) => p.status === 'DELIVERED');
    const returned = parcels.filter((p) => p.status === 'RETURNED');
    const closed = delivered.length + returned.length;
    const fees =
      delivered.reduce((n, p) => n + p.shippingFee + p.codFee, 0) +
      returned.reduce((n, p) => n + p.shippingFee + p.returnFee, 0);
    const reasons = new Map<string, number>();
    for (const p of parcels)
      if (p.lastFailReason) reasons.set(p.lastFailReason, (reasons.get(p.lastFailReason) ?? 0) + 1);
    const byDay = new Map<string, { created: number; delivered: number }>();
    for (const p of parcels) {
      const d = todayInCairo(p.createdAt);
      byDay.set(d, {
        created: (byDay.get(d)?.created ?? 0) + 1,
        delivered: byDay.get(d)?.delivered ?? 0,
      });
    }
    for (const p of delivered) {
      const d = todayInCairo(p.deliveredAt!);
      byDay.set(d, {
        created: byDay.get(d)?.created ?? 0,
        delivered: (byDay.get(d)?.delivered ?? 0) + 1,
      });
    }
    const firstTry = delivered.filter((p) => p.attempts === 0).length;
    return {
      days,
      created: parcels.length,
      delivered: delivered.length,
      returned: returned.length,
      inProgress: parcels.length - closed - parcels.filter((p) => p.status === 'CANCELLED').length,
      deliveryRate: closed ? Math.round((delivered.length / closed) * 1000) / 10 : 0,
      firstAttemptRate: delivered.length
        ? Math.round((firstTry / delivered.length) * 1000) / 10
        : 0,
      codCollected: delivered.reduce((n, p) => n + p.codCollected, 0),
      fees,
      vatInFees: splitVat(fees, s['tax.vat_bp']).vat,
      averageCost: closed ? Math.round(fees / closed) : 0,
      failReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      series: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v })),
    };
  }

  // ---------------------------------------------------------------- the customer, on the tracking page

  /** The customer confirms, picks another day, cancels or rates. The last 4 digits of their phone prove it is them. */
  async customerAction(number: string, body: unknown) {
    const d = parse(ActionInput, body);
    return this.prisma.tx(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { trackingNumber: normalizeCode(number) } });
      if (!s || !s.customerPhone.endsWith(d.phoneLast4)) throw notFound('Parcel');
      const open =
        !['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST'].includes(s.status) &&
        s.direction === 'FORWARD';
      const ev = (type: string, note: string) =>
        tx.shipmentEvent.create({
          data: { shipmentId: s.id, type, fromStatus: s.status, toStatus: s.status, note },
        });
      switch (d.action) {
        case 'RATE': {
          if (s.status !== 'DELIVERED')
            throw new DomainError('bad_status', 'You can rate once the parcel is delivered', 409);
          if (s.rating)
            throw new DomainError('duplicate', 'Thank you, you already rated this delivery', 409);
          await tx.shipment.update({
            where: { id: s.id },
            data: { rating: d.rating, ratingComment: d.note },
          });
          if (d.rating <= 2)
            await openAlert(tx, {
              kind: 'LOW_RATING',
              entity: 'shipment',
              entityId: s.id,
              hubId: s.destinationHubId,
              message: `${s.trackingNumber} rated ${d.rating} of 5${d.note ? `: ${d.note}` : ''}`,
            });
          return { message: 'Thank you for your rating' };
        }
        case 'CONFIRM':
          if (!open)
            throw new DomainError('bad_status', 'This parcel can no longer be changed', 409);
          await tx.shipment.update({
            where: { id: s.id },
            data: { customerNote: d.note.slice(0, 300) },
          });
          await ev('CUSTOMER_CONFIRMED', d.note);
          return { message: 'Thank you. The courier will see your note' };
        case 'POSTPONE': {
          if (!open || s.status === 'OUT_FOR_DELIVERY')
            throw new DomainError(
              'bad_status',
              'This parcel is already on its way today. Call the courier',
              409,
            );
          const today = todayInCairo();
          const max = todayInCairo(new Date(Date.now() + 7 * 86400e3));
          if (d.date <= today || d.date > max)
            throw new DomainError('invalid_input', 'Pick a day within the next week', 422);
          await tx.shipment.update({
            where: { id: s.id },
            data: { deliverOn: d.date, customerNote: d.note.slice(0, 300) },
          });
          await ev('CUSTOMER_POSTPONED', `Customer asked for ${d.date}. ${d.note}`.trim());
          await queueParcelMessage(tx, s.id, 'POSTPONED', { date: d.date });
          return { message: `We will deliver on ${d.date}` };
        }
        case 'CANCEL':
          if (!open || s.status === 'OUT_FOR_DELIVERY')
            throw new DomainError(
              'bad_status',
              'This parcel is already on its way. Refuse it at the door if you no longer want it',
              409,
            );
          await tx.shipment.update({
            where: { id: s.id },
            data: { customerNote: `Customer cancelled: ${d.note}`.slice(0, 300) },
          });
          await ev('CUSTOMER_CANCELLED', d.note);
          await openAlert(tx, {
            kind: 'CUSTOMER_CANCELLED',
            entity: 'shipment',
            entityId: s.id,
            message: `The customer of ${s.trackingNumber} does not want it any more. Ask the merchant`,
          });
          return { message: 'We told the store. They will contact you' };
      }
    });
  }

  // ---------------------------------------------------------------- the outbox

  outbox(status?: string) {
    return this.prisma.message.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Sends queued messages through the provider set in MESSAGES_WEBHOOK_URL (a JSON POST of
   * channel, to and body, with MESSAGES_WEBHOOK_TOKEN as a bearer token). With no provider set,
   * messages stay queued and finance and operations can read them in the outbox.
   */
  async sendQueued() {
    const url = process.env.MESSAGES_WEBHOOK_URL;
    if (!url) return { sent: 0, provider: false };
    const queued = await this.prisma.message.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let sent = 0;
    for (const m of queued) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(process.env.MESSAGES_WEBHOOK_TOKEN
              ? { authorization: `Bearer ${process.env.MESSAGES_WEBHOOK_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({ channel: m.channel, to: m.to, body: m.body, id: m.id }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`provider answered ${res.status}`);
        await this.prisma.message.update({
          where: { id: m.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        sent++;
      } catch (e) {
        await this.prisma.message.update({
          where: { id: m.id },
          data: {
            status: 'FAILED',
            error: e instanceof Error ? e.message.slice(0, 200) : 'failed',
          },
        });
      }
    }
    return { sent, provider: true };
  }
}
