/*
 * Demo data generator: 100 merchants and 2,000 orders over the last 60 days, with realistic
 * journeys (pickup, sorting, transfers, delivery, failed attempts, returns) and the money that
 * goes with them, posted with the same rules as the live system so every report balances.
 *
 *   pnpm db:demo            (after pnpm db:seed)
 *
 * Runs as the database owner (MIGRATE_DATABASE_URL) because it writes history with past
 * timestamps directly. It refuses to run twice.
 */
import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildTrackingNumber, FAILED_ATTEMPT_REASONS, OrderStatus, PricingZone } from '@shiply/shared';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  cashoutFee, cashoutPaid, codCollected, deliveredSettlement, deposit, driverHandover, failedSettlement, Line,
  merchantAdjustment, shortageRepaid, ACC, failedFeeAmounts,
} from '../src/accounting/posting';
import { haversineKm } from '../src/geo/geo';
import { calculatePrice, PricingConfig } from '../src/pricing/pricing.engine';
import {
  CATEGORIES, COMPENSATION_REASONS, DEDUCTION_REASONS, DESTINATION_WEIGHTS, FIRST_AR, FIRST_EN, LAST_AR, LAST_EN,
  REGIONAL_AREAS, REGIONAL_HUBS, STREETS_AR, STREETS_EN,
} from './demo-data';
import { CHART_OF_ACCOUNTS } from './seed-data';

const TARGET_MERCHANTS = 100;
const TARGET_ORDERS = 2000;
const DAYS = 60;
const TZ_OFFSET_H = 3; // Cairo
const H = 3600_000;
const PASSWORD = 'Shiply@2026';

// ───── deterministic randomness so the demo looks the same every time ─────
let seedState = 20261003;
function rnd() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

// ───── Cairo local time helpers ─────
const now = new Date();
const localMidnight = (t: number) => {
  const local = t + TZ_OFFSET_H * H;
  return local - (local % (24 * H)) - TZ_OFFSET_H * H;
};
const todayStart = localMidnight(now.getTime());
const windowStart = todayStart - DAYS * 24 * H;
/** Local hour of day (fractional) for an instant. */
const localHour = (t: number) => ((t + TZ_OFFSET_H * H) % (24 * H)) / H;
/** The instant at local hour h on the day of t, plus dayOffset days. */
const atLocal = (t: number, h: number, dayOffset = 0) => localMidnight(t) + dayOffset * 24 * H + h * H;
/** Next occurrence of local hour h strictly after t. */
const nextLocal = (t: number, h: number) => (localHour(t) < h ? atLocal(t, h) : atLocal(t, h, 1));

const egp = (n: number) => Math.round(n) * 100;

interface Step {
  status: OrderStatus;
  at: number;
  hubId?: string | null;
  note?: string;
  meta?: Record<string, unknown>;
  failedReason?: string;
  deliveryDriverId?: string;
}

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error('MIGRATE_DATABASE_URL is not set');
  const db = new PrismaClient({ datasourceUrl: url });

  const marker = await db.auditLog.findFirst({ where: { action: 'demo.generate' } });
  if (marker) {
    console.log('Demo data already generated on', marker.createdAt.toISOString().slice(0, 10), '. Nothing to do.');
    await db.$disconnect();
    return;
  }
  if ((await db.merchant.count()) === 0) throw new Error('Run pnpm db:seed first');
  const t0 = Date.now();
  const hash = await bcrypt.hash(PASSWORD, 10);

  for (const a of CHART_OF_ACCOUNTS) {
    await db.ledgerAccount.upsert({ where: { code: a.code }, update: {}, create: { code: a.code, nameEn: a.en, nameAr: a.ar, type: a.type, description: a.d } });
  }

  // ───── hubs and areas ─────
  for (const h of REGIONAL_HUBS) {
    await db.hub.upsert({
      where: { code: h.code },
      update: {},
      create: { code: h.code, nameEn: h.nameEn, nameAr: h.nameAr, governorateCode: h.gov, addressLine: h.address, lat: h.lat, lng: h.lng, receivesPickups: h.receivesPickups, dispatchesLastMile: h.dispatchesLastMile },
    });
  }
  for (const a of REGIONAL_AREAS) {
    if (!(await db.area.findFirst({ where: { nameEn: a.en } }))) {
      await db.area.create({ data: { governorateCode: a.gov, nameEn: a.en, nameAr: a.ar, lat: a.lat, lng: a.lng, keywords: [] } });
    }
  }
  const hubs = await db.hub.findMany();
  const hubByCode = Object.fromEntries(hubs.map((h) => [h.code, h]));
  const sf = hubByCode['CAI-SF'];
  const lastMile = hubs.filter((h) => h.dispatchesLastMile);
  const areas = await db.area.findMany({ include: { governorate: true } });
  const areaByName = Object.fromEntries(areas.map((a) => [a.nameEn, a]));

  // ───── drivers ─────
  const extraDrivers: { type: 'PICKUP' | 'DELIVERY'; name: string; hub: string }[] = [
    { type: 'PICKUP', name: 'Sameh Fawzy', hub: 'CAI-SF' }, { type: 'PICKUP', name: 'Ibrahim Gamal', hub: 'CAI-SF' },
    { type: 'PICKUP', name: 'Waleed Hamdy', hub: 'CAI-SF' }, { type: 'PICKUP', name: 'Ayman Lotfy', hub: 'ASYUT' },
    { type: 'DELIVERY', name: 'Mostafa Ezzat', hub: 'MAADI' }, { type: 'DELIVERY', name: 'Hossam Ramadan', hub: 'MAADI' },
    { type: 'DELIVERY', name: 'Amr Soliman', hub: 'NASR' }, { type: 'DELIVERY', name: 'Sherif Zaki', hub: 'NASR' }, { type: 'DELIVERY', name: 'Islam Farouk', hub: 'NASR' },
    { type: 'DELIVERY', name: 'Mohamed Hegazy', hub: 'MOHN' }, { type: 'DELIVERY', name: 'Ahmed Morsy', hub: 'MOHN' },
    { type: 'DELIVERY', name: 'Khaled Salah', hub: 'OCT' }, { type: 'DELIVERY', name: 'Bassem Nabil', hub: 'OCT' },
    { type: 'DELIVERY', name: 'Ehab Kamal', hub: 'ALX' }, { type: 'DELIVERY', name: 'Ramy Ashraf', hub: 'ALX' },
    { type: 'DELIVERY', name: 'Tamer Shaker', hub: 'TANTA' }, { type: 'DELIVERY', name: 'Fady Adel', hub: 'MANS' },
    { type: 'DELIVERY', name: 'Medhat Saeed', hub: 'ASYUT' },
  ];
  let phoneSeq = 300;
  for (const d of extraDrivers) {
    if (await db.driver.findFirst({ where: { fullName: d.name } })) continue;
    const phone = `+2010000${String(phoneSeq++).padStart(5, '0')}`;
    const user = await db.user.create({
      data: { email: `${d.name.toLowerCase().replace(/\s+/g, '.')}@drivers.shiply.eg`, phone, fullName: d.name, role: d.type === 'PICKUP' ? 'PICKUP_DRIVER' : 'DELIVERY_DRIVER', passwordHash: hash, hubId: hubByCode[d.hub].id, createdAt: new Date(windowStart - int(30, 300) * 24 * H) },
    });
    await db.driver.create({ data: { userId: user.id, type: d.type, fullName: d.name, phone, vehicle: d.type === 'PICKUP' ? 'VAN' : 'MOTORCYCLE', hubId: hubByCode[d.hub].id, createdAt: user.createdAt } });
  }
  const drivers = await db.driver.findMany({ where: { status: 'ACTIVE' } });
  const pickupDrivers = drivers.filter((d) => d.type === 'PICKUP' && d.hubId === sf.id);
  const deliveryDriversByHub = new Map<string, typeof drivers>();
  for (const d of drivers.filter((x) => x.type === 'DELIVERY')) {
    deliveryDriversByHub.set(d.hubId!, [...(deliveryDriversByHub.get(d.hubId!) ?? []), d]);
  }
  console.log(`hubs: ${hubs.length}, drivers: ${drivers.length}`);

  // ───── merchants ─────
  const existing = await db.merchant.findMany({ include: { pickupLocations: true } });
  const usedNames = new Set(existing.map((m) => m.nameEn));
  const cairoAreas = areas.filter((a) => a.governorateCode === 'CAI' || a.governorateCode === 'GIZ');
  const merchantCategory = new Map<string, (typeof CATEGORIES)[number]>();
  // A rerun after a failure finds its earlier merchants again by name.
  for (const m of existing) merchantCategory.set(m.id, CATEGORIES.find((c) => c.en.some((w) => c.suffixEn.some((sfx) => `${w} ${sfx}` === m.nameEn))) ?? CATEGORIES[0]);
  let codeSeq = existing.filter((m) => /^M\d{3}$/.test(m.code)).length + 1;
  let created = 0;
  while (existing.length + created < TARGET_MERCHANTS) {
    const cat = weighted(CATEGORIES.map((c) => [c, c.key === 'fashion' ? 5 : c.key === 'beauty' ? 3 : c.key === 'electronics' ? 2 : c.key === 'home' ? 2 : 1] as [typeof c, number]));
    const i = Math.floor(rnd() * cat.en.length);
    const j = Math.floor(rnd() * cat.suffixEn.length);
    const nameEn = `${cat.en[i]} ${cat.suffixEn[j]}`;
    if (usedNames.has(nameEn)) continue;
    usedNames.add(nameEn);
    const nameAr = `${cat.ar[i]} ${cat.suffixAr[j]}`;
    const slug = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const code = `M${String(codeSeq++).padStart(3, '0')}`;
    const tier = weighted<'BRONZE' | 'SILVER' | 'GOLD'>([['BRONZE', 60], ['SILVER', 28], ['GOLD', 12]]);
    const createdAt = new Date(windowStart - int(5, 420) * 24 * H);
    const m = await db.merchant.create({
      data: {
        code, nameEn, nameAr, tier, vatEnabled: chance(0.85),
        cashoutFrequency: weighted<'DAILY' | 'EVERY_2_DAYS' | 'WEEKLY'>([['WEEKLY', 55], ['EVERY_2_DAYS', 25], ['DAILY', 20]]),
        defaultOpenPackage: chance(0.3), createdAt,
      },
    });
    merchantCategory.set(m.id, cat);
    const locs = chance(0.2) ? 2 : 1;
    for (let k = 0; k < locs; k++) {
      const a = pick(cairoAreas);
      await db.pickupLocation.create({
        data: { merchantId: m.id, name: k === 0 ? 'Main warehouse' : 'Second branch', governorateCode: a.governorateCode, area: a.nameEn, addressLine: `${int(1, 120)} ${pick(STREETS_EN)}, ${a.nameEn}`, lat: a.lat, lng: a.lng, isDefault: k === 0, contactPhone: phoneNumber(), createdAt },
      });
    }
    await db.user.create({ data: { email: `owner@${slug}.eg`, fullName: `${pick(FIRST_EN)} ${pick(LAST_EN)}`, role: 'MERCHANT_OWNER', merchantId: m.id, passwordHash: hash, language: chance(0.35) ? 'ar' : 'en', createdAt } });
    if (chance(0.7)) {
      await db.merchantBankDetails.create({
        data: { merchantId: m.id, bankName: pick(['CIB', 'NBE', 'Banque Misr', 'QNB', 'HSBC Egypt', 'AAIB']), accountName: `${nameEn} LLC`, iban: `EG${String(int(10, 99))}${String(Math.floor(rnd() * 1e15)).padStart(15, '0')}${String(Math.floor(rnd() * 1e10)).padStart(10, '0')}`, lastChangedAt: new Date(windowStart - 30 * 24 * H) },
      });
    }
    created++;
  }
  const merchants = await db.merchant.findMany({ include: { pickupLocations: true, users: true, bankDetails: true, parent: true } });
  console.log(`merchants: ${merchants.length} (${created} new)`);

  // ───── pricing inputs (read once, used with the live pricing engine) ─────
  const cfgRows = await db.systemConfig.findMany();
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  const pricingCfg: PricingConfig = {
    exchangeMultiplierBp: cfg['pricing.exchange_multiplier_bp'] as number,
    returnMultiplierBp: cfg['pricing.return_multiplier_bp'] as number,
    failedDeliveryRateBp: cfg['pricing.failed_delivery_rate_bp'] as number,
    vatRateBp: cfg['pricing.vat_rate_bp'] as number,
    codFeeThreshold: cfg['pricing.cod_fee_threshold'] as number,
    codFeeRateBp: cfg['pricing.cod_fee_rate_bp'] as number,
    codFeeMode: cfg['pricing.cod_fee_mode'] as 'excess' | 'full',
    openPackageFee: cfg['pricing.open_package_fee'] as number,
    vatAppliesToFees: cfg['pricing.vat_applies_to_fees'] as boolean,
  };
  const zonePrices = await db.pricingZonePrice.findMany();
  const sizeAdds = await db.pricingSizeAdjustment.findMany();
  const tierAdj = await db.pricingTierAdjustment.findMany();
  const prefix = cfg['orders.tracking_prefix'] as string;
  const feeCfg = { bankFlat: cfg['merchant.cashout_fee_bank'] as number, fawryAccountBp: cfg['merchant.cashout_fee_fawry_account_bp'] as number, fawryCardBp: cfg['merchant.cashout_fee_fawry_card_bp'] as number };

  // ───── order volume per merchant (a few big merchants, a long tail) ─────
  const anchor: Record<string, number> = { EVE: 230, NABTA: 120, ESS: 100, HANSER: 80 };
  const tail = merchants.filter((m) => !anchor[m.code]);
  const weights = tail.map((_, i) => 1 / Math.pow(i + 1, 0.75));
  const tailTotal = TARGET_ORDERS - Object.values(anchor).reduce((a, b) => a + b, 0);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const volume = new Map<string, number>();
  merchants.forEach((m) => anchor[m.code] && volume.set(m.id, anchor[m.code]));
  tail.forEach((m, i) => volume.set(m.id, Math.max(3, Math.round((weights[i] / wSum) * tailTotal))));

  // Customers: a pool so repeat buyers exist (customer success score has history).
  const customers = Array.from({ length: 1500 }, () => {
    const arabic = chance(0.25);
    return { name: arabic ? `${pick(FIRST_AR)} ${pick(LAST_AR)}` : `${pick(FIRST_EN)} ${pick(LAST_EN)}`, phone: phoneNumber(), arabic };
  });

  // ───── simulate orders ─────
  const destPool = DESTINATION_WEIGHTS.filter(([n]) => areaByName[n]).map(([n, w]) => [areaByName[n], w] as [(typeof areas)[number], number]);
  const dayWeights: [number, number][] = [];
  for (let d = 0; d <= DAYS; d++) {
    const t = windowStart + d * 24 * H;
    const dow = new Date(t + TZ_OFFSET_H * H + 12 * H).getUTCDay(); // 5 = Friday
    dayWeights.push([d, (0.55 + (d / DAYS) * 0.9) * (dow === 5 ? 0.55 : dow === 6 ? 0.85 : 1)]);
  }

  const seq = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('tracking_number_seq')`;
  let trackingSeq = Number(seq[0].nextval);
  const ops = await db.user.findUniqueOrThrow({ where: { email: 'ops@shiply.eg' } });

  type Gen = Prisma.OrderUncheckedCreateInput & { steps: Step[]; createdMs: number };
  const orders: Gen[] = [];
  for (const m of merchants) {
    const cat = merchantCategory.get(m.id) ?? CATEGORIES[0];
    const n = volume.get(m.id) ?? 0;
    const tier = m.parent?.tier ?? m.tier;
    for (let k = 0; k < n; k++) {
      const day = weighted(dayWeights);
      let created = windowStart + day * 24 * H + weighted<number>([[9, 1], [11, 2], [13, 3], [15, 3], [17, 3], [19, 4], [21, 4], [22.5, 2]]) * H + between(0, 1.5) * H;
      if (created > now.getTime() - 10 * 60_000) created = now.getTime() - between(0.2, 6) * H;
      if (created < windowStart) created = windowStart + between(1, 20) * H;
      const cust = chance(0.15) ? customers[int(0, 120)] : pick(customers);
      const area = weighted(destPool);
      const loc = m.pickupLocations.find((p) => p.isDefault) ?? m.pickupLocations[0];
      const type = weighted<'DELIVER' | 'EXCHANGE' | 'RETURN'>([['DELIVER', 88], ['EXCHANGE', 8], ['RETURN', 4]]);
      const size = pick(cat.sizes) as never;
      const prepaid = type === 'RETURN' || chance(0.12);
      const cod = prepaid ? 0 : egp(between(cat.cod[0], cat.cod[1]) / 5) * 5;
      const open = m.defaultOpenPackage ? chance(0.8) : chance(0.15);
      const destZone = (area.pricingZone ?? area.governorate.pricingZone) as PricingZone;
      const zp = zonePrices.find((z) => z.pickupZone === 'CAIRO_GIZA' && z.destZone === destZone)!;
      const price = calculatePrice(
        { pickupZone: 'CAIRO_GIZA', destZone, size, orderType: type, tier, codAmount: cod, allowOpenPackage: open, vatEnabled: m.vatEnabled },
        { zoneBasePrice: zp.basePricePiastres, sizeAdd: sizeAdds.find((s) => s.size === size)?.addPiastres ?? 0, tierMultiplierBp: tierAdj.find((x) => x.tier === tier)?.multiplierBp ?? 10000, overridePrice: null },
        pricingCfg,
      );
      const lat = area.lat + between(-0.006, 0.006);
      const lng = area.lng + between(-0.006, 0.006);
      // Nearest last mile hub; far destinations are assigned to it manually by operations.
      let dest = lastMile[0];
      let best = Infinity;
      for (const h of lastMile) {
        const km = haversineKm({ lat, lng }, h);
        if (km < best) {
          best = km;
          dest = h;
        }
      }
      const manual = best > 40;
      const id = randomUUID();
      const item = pick(cat.items);
      const steps = planJourney({ created, cod, dest: dest.id, regional: !['MAADI', 'NASR', 'MOHN', 'OCT'].includes(dest.code), type });
      const source = weighted<'CSV' | 'MANUAL' | 'API'>([['CSV', 55], ['MANUAL', 35], ['API', 10]]);
      orders.push({
        id,
        merchantId: m.id,
        trackingNumber: buildTrackingNumber(prefix, trackingSeq++),
        merchantReference: chance(0.7) ? `#${int(1001, 98999)}` : null,
        type,
        size,
        source,
        customerName: cust.name,
        customerPhone: cust.phone,
        governorateCode: area.governorateCode,
        area: cust.arabic ? area.nameAr : area.nameEn,
        addressLine: cust.arabic ? `${int(1, 90)} ${pick(STREETS_AR)}، ${area.nameAr}` : `${pick(['Building', 'Villa', 'Apt'])} ${int(1, 120)}, ${pick(STREETS_EN)}, ${area.nameEn}`,
        lat,
        lng,
        geocodeSource: 'mock:area',
        pickupLocationId: loc.id,
        pickupZone: 'CAIRO_GIZA',
        destZone,
        destinationHubId: dest.id,
        needsManualHub: false,
        codAmount: cod,
        allowOpenPackage: open,
        itemsDescription: type === 'RETURN' ? null : item,
        returnItemsDescription: type === 'DELIVER' ? null : pick(cat.items),
        notes: chance(0.15) ? pick(['Call before arrival', 'Deliver after 5pm', 'Leave with the doorman', 'Fragile', 'Gift, do not show the price']) : null,
        shippingFee: price.shippingFee,
        codFee: price.codFee,
        openPackageFee: price.openPackageFee,
        vatAmount: price.vatAmount,
        totalFees: price.totalFees,
        failedDeliveryFee: price.failedDeliveryFee,
        pricingSnapshot: { ...price.snapshot, calculatedAt: new Date(created).toISOString() } as Prisma.InputJsonValue,
        createdById: m.users.find((u) => u.role === 'MERCHANT_OWNER')?.id ?? null,
        createdAt: new Date(created),
        updatedAt: new Date(created),
        steps,
        createdMs: created,
        ...(manual ? { notes: 'Hub assigned manually by operations' } : {}),
      });
    }
  }
  orders.sort((a, b) => a.createdMs - b.createdMs);
  console.log(`orders planned: ${orders.length}`);

  function planJourney(o: { created: number; cod: number; dest: string; regional: boolean; type: string }): Step[] {
    const s: Step[] = [{ status: 'NEW', at: o.created }];
    let t = o.created;
    const outcome = weighted<'delivered' | 'retry_delivered' | 'returned' | 'unsuccessful' | 'cancelled'>([
      ['delivered', 78], ['retry_delivered', 8], ['returned', 9], ['unsuccessful', 2.5], ['cancelled', 2.5],
    ]);
    t += between(0.2, 5) * H;
    const pickupDriver = pick(pickupDrivers);
    s.push({ status: 'PENDING_PICKUP', at: t, note: `Pickup assigned to ${pickupDriver.fullName}`, meta: { pickupDriverId: pickupDriver.id } });
    if (outcome === 'cancelled') {
      s.push({ status: 'TERMINATED', at: t + between(1, 20) * H, note: pick(['Customer cancelled the order', 'Out of stock', 'Duplicate order']) });
      return s;
    }
    t = localHour(t) < 14 ? atLocal(t, between(15, 19)) : atLocal(t, between(11, 17), 1);
    s.push({ status: 'PICKED_UP', at: t, note: `Picked up by ${pickupDriver.fullName}`, meta: { pickupDriverId: pickupDriver.id } });
    t += between(1, 3) * H;
    s.push({ status: 'AT_SORTING_FACILITY', at: t, hubId: sf.id, note: 'Scanned in at Cairo Sorting Facility' });
    const depart = nextLocal(t, o.regional ? 21 : 7);
    s.push({ status: 'IN_TRANSFER', at: depart, hubId: sf.id, meta: { transferKey: `${depart}|${sf.id}|${o.dest}` } });
    t = depart + (o.regional ? between(5, 9) : between(1.5, 3)) * H;
    s.push({ status: 'AT_LAST_MILE_HUB', at: t, hubId: o.dest, note: 'Scanned in at last mile hub' });
    const pool = deliveryDriversByHub.get(o.dest) ?? [];
    const attempt = (from: number): { at: number; driver: (typeof pool)[number] } => {
      const d = pick(pool);
      const assigned = localHour(from) < 11 ? from + between(0.5, 1.5) * H : atLocal(from, between(8.5, 10), 1);
      s.push({ status: 'ASSIGNED_TO_DRIVER', at: assigned, note: `Assigned to ${d.fullName}`, deliveryDriverId: d.id, meta: { deliveryDriverId: d.id } });
      const out = assigned + between(0.3, 1) * H;
      s.push({ status: 'HEADING_TO_CUSTOMER', at: out, note: 'Out for delivery', deliveryDriverId: d.id });
      return { at: out + between(0.5, 7) * H, driver: d };
    };
    let a = attempt(t);
    if (outcome === 'delivered') {
      s.push({ status: 'DELIVERED', at: a.at, note: 'Delivered', deliveryDriverId: a.driver.id, meta: { deliveryDriverId: a.driver.id, codCollected: o.cod } });
      return s;
    }
    const reason = pick(FAILED_ATTEMPT_REASONS.filter((r) => r !== 'POSTPONE_REQUESTED' || outcome === 'retry_delivered'));
    s.push({ status: 'AWAITING_MERCHANT_ACTION', at: a.at, failedReason: reason, deliveryDriverId: a.driver.id, note: `Failed attempt: ${reason}` });
    const decision = a.at + between(4, 30) * H;
    if (outcome === 'retry_delivered') {
      a = attempt(decision);
      s.push({ status: 'DELIVERED', at: a.at, note: 'Delivered on second attempt', deliveryDriverId: a.driver.id, meta: { deliveryDriverId: a.driver.id, codCollected: o.cod } });
      return s;
    }
    if (outcome === 'unsuccessful') {
      s.push({ status: 'UNSUCCESSFUL', at: decision, note: 'Merchant chose not to retry' });
      return s;
    }
    const back = nextLocal(decision, 18);
    s.push({ status: 'RETURNS_ON_WAY', at: back, hubId: o.dest, note: 'Return to merchant started', meta: { transferKey: `${back}|${o.dest}|${sf.id}` } });
    t = back + between(2, 9) * H;
    s.push({ status: 'AT_SORTING_FACILITY', at: t, hubId: sf.id, note: 'Return received at sorting facility' });
    t = atLocal(t, between(11, 15), 1);
    s.push({ status: 'HEADING_TO_MERCHANT', at: t, note: 'Returning to merchant' });
    s.push({ status: 'RETURNED', at: t + between(1, 4) * H, note: 'Returned to merchant' });
    return s;
  }

  // ───── cut every journey at "now" and derive order fields ─────
  const events: Prisma.OrderEventCreateManyInput[] = [];
  const transferMap = new Map<string, { id: string; origin: string; dest: string; depart: number; orders: { orderId: string; arrived: number | null }[] }>();
  const nowMs = now.getTime();
  const driverWork: { driverId: string; at: number; kind: 'pickup' | 'delivery' | 'attempt' }[] = [];
  const finals = new Set(['DELIVERED', 'RETURNED', 'UNSUCCESSFUL', 'TERMINATED']);
  for (const o of orders) {
    const reached = o.steps.filter((st) => st.at <= nowMs);
    const last = reached[reached.length - 1];
    o.status = last.status;
    o.updatedAt = new Date(last.at);
    let attempts = 0;
    for (let i = 0; i < reached.length; i++) {
      const st = reached[i];
      if (st.meta?.pickupDriverId) o.pickupDriverId = st.meta.pickupDriverId as string;
      if (st.deliveryDriverId) o.deliveryDriverId = st.deliveryDriverId;
      if (st.status === 'PICKED_UP' && st.meta?.pickupDriverId) driverWork.push({ driverId: st.meta.pickupDriverId as string, at: st.at, kind: 'pickup' });
      if (st.status === 'DELIVERED' && st.deliveryDriverId) driverWork.push({ driverId: st.deliveryDriverId, at: st.at, kind: 'delivery' });
      if (st.failedReason) {
        if (st.deliveryDriverId) driverWork.push({ driverId: st.deliveryDriverId, at: st.at, kind: 'attempt' });
        attempts++;
        o.lastFailedReason = st.failedReason;
      }
      if (st.status === 'RETURNS_ON_WAY') o.isReturning = true;
      if (st.meta?.transferKey) {
        const key = st.meta.transferKey as string;
        const [dep, origin, dest] = key.split('|');
        if (!transferMap.has(key)) transferMap.set(key, { id: randomUUID(), origin, dest, depart: Number(dep), orders: [] });
        const next = reached[i + 1];
        transferMap.get(key)!.orders.push({ orderId: o.id as string, arrived: next ? next.at : null });
      }
      const prev = i === 0 ? null : reached[i - 1];
      events.push({
        orderId: o.id as string,
        merchantId: o.merchantId,
        eventType: i === 0 ? 'CREATED' : 'STATUS_CHANGED',
        fromStatus: prev ? prev.status : null,
        toStatus: st.status,
        note: i === 0 ? `Created via ${o.source}` : st.note ?? null,
        actorId: i === 0 ? (o.createdById as string | null) : ops.id,
        actorRole: i === 0 ? 'MERCHANT_OWNER' : 'OPERATIONS_MANAGER',
        hubId: st.hubId ?? null,
        metadata: (st.meta ? Object.fromEntries(Object.entries(st.meta).filter(([k]) => k !== 'transferKey')) : {}) as Prisma.InputJsonValue,
        createdAt: new Date(st.at),
      });
      if (i === 1) {
        o.printCount = 1;
        o.labelPrintedAt = new Date(st.at - 10 * 60_000);
        events.push({ orderId: o.id as string, merchantId: o.merchantId, eventType: 'LABEL_PRINTED', actorId: o.createdById as string | null, actorRole: 'MERCHANT_OWNER', metadata: { printNumber: 1 }, createdAt: new Date(st.at - 10 * 60_000) });
      }
    }
    o.attempts = attempts;
    const hubStatuses: Record<string, string | null> = {
      AT_SORTING_FACILITY: sf.id, AT_LAST_MILE_HUB: o.destinationHubId as string, AWAITING_MERCHANT_ACTION: o.destinationHubId as string,
    };
    o.currentHubId = hubStatuses[last.status] ?? null;
    if (finals.has(last.status) && last.status !== 'TERMINATED') o.finalizedAt = new Date(last.at);
  }

  // ───── money, in time order ─────
  interface J { key: string; type: Prisma.JournalEntryCreateManyInput['type']; description: string; at: number; merchantId?: string | null; orderId?: string | null; lines: Line[]; ref?: [string, string] }
  const journals: J[] = [];
  const post = (j: J) => journals.push(j);
  const capitalAt = windowStart - 2 * 24 * H;
  post({ key: 'demo:opening', type: 'OPENING_BALANCE', description: 'Opening capital', at: capitalAt, lines: [{ account: ACC.BANK, debit: egp(400000), memo: 'Opening capital' }, { account: ACC.EQUITY, credit: egp(400000), memo: 'Opening capital' }] });

  const byId = new Map(orders.map((o) => [o.id as string, o]));
  const merchantDeltas = new Map<string, { at: number; amount: number }[]>();
  const addDelta = (mid: string, at: number, amount: number) => merchantDeltas.set(mid, [...(merchantDeltas.get(mid) ?? []), { at, amount }]);
  const runs = new Map<number, { settled: number; charged: number }>();
  const deliveriesByDriverDay = new Map<string, { driverId: string; day: number; amount: number; orders: string[] }>();

  for (const o of orders) {
    const money = { ...o, id: o.id as string, merchantId: o.merchantId, trackingNumber: o.trackingNumber, pricingSnapshot: o.pricingSnapshot } as never as Parameters<typeof codCollected>[0];
    if (o.status === 'DELIVERED' && o.codAmount && o.codAmount > 0) {
      const at = o.finalizedAt!.valueOf() as number;
      post({ key: `cod:${o.id}`, type: 'COD_COLLECTED', description: `COD collected for ${o.trackingNumber}`, at, merchantId: o.merchantId, orderId: o.id as string, lines: codCollected(money, o.deliveryDriverId as string) });
      const day = localMidnight(at);
      const k = `${o.deliveryDriverId}|${day}`;
      const e = deliveriesByDriverDay.get(k) ?? { driverId: o.deliveryDriverId as string, day, amount: 0, orders: [] };
      e.amount += o.codAmount;
      e.orders.push(o.id as string);
      deliveriesByDriverDay.set(k, e);
    }
    if (o.finalizedAt) {
      const runAt = localMidnight(o.finalizedAt.valueOf() as number) + 24 * H + 5 * 60_000;
      if (runAt <= nowMs) {
        o.settledAt = new Date(runAt);
        const r = runs.get(runAt) ?? { settled: 0, charged: 0 };
        if (o.status === 'DELIVERED') {
          r.settled++;
          if ((o.codAmount ?? 0) > 0 || (o.totalFees ?? 0) > 0) {
            post({ key: `settle:${o.id}`, type: 'ORDER_SETTLEMENT', description: `Settlement ${o.trackingNumber}`, at: runAt, merchantId: o.merchantId, orderId: o.id as string, lines: deliveredSettlement(money), ref: ['order', o.id as string] });
            addDelta(o.merchantId, runAt, (o.codAmount ?? 0) - (o.totalFees ?? 0));
          }
        } else {
          r.charged++;
          const { fee, vat } = failedFeeAmounts(money);
          post({ key: `settle:${o.id}`, type: 'FAILED_DELIVERY_FEE', description: `Failed delivery charge ${o.trackingNumber}`, at: runAt, merchantId: o.merchantId, orderId: o.id as string, lines: failedSettlement(money), ref: ['order', o.id as string] });
          addDelta(o.merchantId, runAt, -(fee + vat));
        }
        runs.set(runAt, r);
      }
    }
  }

  // Driver end of day handovers at 21:00, a few short; repayments a few days later; hub safe to bank next morning.
  const handovers: Prisma.CashHandoverCreateManyInput[] = [];
  const alerts: Prisma.AlertCreateManyInput[] = [];
  const handoverOfOrder = new Map<string, string>();
  const safeByDay = new Map<number, number>();
  for (const e of [...deliveriesByDriverDay.values()].sort((a, b) => a.day - b.day)) {
    const at = e.day + 21 * H - TZ_OFFSET_H * H + TZ_OFFSET_H * H;
    if (at > nowMs) continue;
    const short = chance(0.05) ? Math.min(e.amount, egp(int(2, 12) * 5)) : 0;
    const received = e.amount - short;
    const id = randomUUID();
    const driver = drivers.find((d) => d.id === e.driverId)!;
    post({ key: `handover:${id}`, type: 'DRIVER_HANDOVER', description: `Handover ${driver.fullName}: End of day`, at, lines: driverHandover(e.driverId, e.amount, received, `Handover ${driver.fullName}`), ref: ['cash_handover', id] });
    handovers.push({ id, driverId: e.driverId, hubId: driver.hubId, expectedAmount: e.amount, receivedAmount: received, difference: -short, status: short ? 'SHORT' : 'BALANCED', note: 'End of day', receivedById: ops.id, createdAt: new Date(at) });
    e.orders.forEach((oid) => handoverOfOrder.set(oid, id));
    safeByDay.set(e.day, (safeByDay.get(e.day) ?? 0) + received);
    if (short) {
      const repaid = at + int(1, 5) * 24 * H;
      const willRepay = repaid <= nowMs && chance(0.75);
      alerts.push({ kind: 'CASH_SHORTAGE', severity: short > e.amount * 0.05 ? 'HIGH' : 'MEDIUM', message: `${driver.fullName} handed in ${(received / 100).toFixed(2)} EGP, expected ${(e.amount / 100).toFixed(2)} EGP`, entityType: 'cash_handover', entityId: id, data: { driverId: e.driverId }, status: willRepay ? 'RESOLVED' : 'OPEN', resolution: willRepay ? 'Driver repaid the shortage' : null, resolvedById: willRepay ? ops.id : null, resolvedAt: willRepay ? new Date(repaid) : null, createdAt: new Date(at) });
      if (willRepay) {
        post({ key: `shortage:${id}`, type: 'DRIVER_HANDOVER', description: `Shortage repaid by ${driver.fullName}`, at: repaid, lines: shortageRepaid(e.driverId, short, `Shortage repaid ${driver.fullName}`) });
        const d = localMidnight(repaid);
        safeByDay.set(d, (safeByDay.get(d) ?? 0) + short);
      }
    }
  }
  for (const [oid, hid] of handoverOfOrder) byId.get(oid)!.cashHandoverId = hid;

  const deposits: Prisma.CashDepositCreateManyInput[] = [];
  let depSeq = 1;
  for (const [day, amount] of [...safeByDay.entries()].sort((a, b) => a[0] - b[0])) {
    const at = day + 24 * H + 11 * H;
    if (at > nowMs || amount <= 0) continue;
    const ref = `BANK-${new Date(at).toISOString().slice(2, 10).replace(/-/g, '')}-${String(depSeq++).padStart(4, '0')}`;
    post({ key: `deposit:${ref}`, type: 'CASH_DEPOSIT', description: `HUB_TO_BANK ${ref}`, at, lines: deposit('HUB_TO_BANK', amount, `HUB_TO_BANK ${ref}`), ref: ['deposit', ref] });
    deposits.push({ kind: 'HUB_TO_BANK', reference: ref, amount, depositedAt: new Date(at), note: 'Daily hub safe deposit', journalId: BigInt(0), recordedById: ops.id, createdAt: new Date(at) });
  }
  // ───── operating expenses, paid from the bank ─────
  const expense = (key: string, at: number, account: string, amount: number, memo: string, driverId?: string) => {
    if (at > nowMs || amount <= 0) return;
    post({ key, type: 'EXPENSE', description: memo, at, lines: [{ account, debit: amount, memo, driverId }, { account: ACC.BANK, credit: amount, memo }] });
  };
  // Drivers are paid every Thursday at 18:00 for the work since the last payday.
  const rate = { pickup: egp(4), delivery: egp(15), attempt: egp(6) };
  const pay = new Map<string, number>();
  for (const w of driverWork) {
    let payday = atLocal(w.at, 18);
    while (new Date(payday + TZ_OFFSET_H * H).getUTCDay() !== 4 || payday < w.at) payday += 24 * H;
    const k = `${w.driverId}|${payday}`;
    pay.set(k, (pay.get(k) ?? 0) + rate[w.kind]);
  }
  for (const [k, amount] of [...pay.entries()].sort()) {
    const [driverId, payday] = k.split('|');
    const d = drivers.find((x) => x.id === driverId);
    expense(`driverpay:${k}`, Number(payday), '5010', amount, `Weekly pay ${d?.fullName ?? ''}`.trim(), driverId);
  }
  // Monthly items: rent paid in advance on the 25th, salaries and bank charges on the 28th, utilities on the 10th.
  const monthly: [number, string, number, string][] = [
    [28, '5050', 22500, 'Staff salaries (operations, finance, customer service)'],
    [25, '5060', 9000, 'Hub rent for next month: sorting facility and last mile hubs'],
    [10, '5060', 1800, 'Electricity, internet and water'],
    [28, '5040', 450, 'Bank account and transfer charges'],
  ];
  for (let d = -2; d <= DAYS; d++) {
    const day = windowStart + d * 24 * H;
    const date = new Date(day + 12 * H).getUTCDate();
    for (const [dom, account, amount, memo] of monthly) if (date === dom) expense(`monthly:${account}:${day}:${amount}`, day + 13 * H, account, egp(amount * between(0.97, 1.03)), memo);
    // Fuel and vehicle upkeep every Saturday, packaging supplies every second Monday.
    const dow = new Date(day + 12 * H).getUTCDay();
    if (dow === 6) expense(`fuel:${day}`, day + 12 * H, '5070', egp(between(1500, 2300)), 'Fuel and vehicle maintenance');
    if (dow === 1 && d % 14 < 7) expense(`supplies:${day}`, day + 12 * H, '5080', egp(between(600, 1100)), 'Packaging, labels and printer supplies');
  }


  // Compensations and deductions on a handful of finished orders.
  const finished = orders.filter((o) => o.settledAt);
  for (let i = 0; i < 14; i++) {
    const o = pick(finished);
    const comp = i < 11;
    const amount = egp(int(5, 60) * 5);
    const at = (o.settledAt!.valueOf() as number) + between(20, 70) * H;
    if (at > nowMs) continue;
    const reason = comp ? pick(COMPENSATION_REASONS) : pick(DEDUCTION_REASONS);
    const label = comp ? 'Compensation' : 'Deduction';
    post({ key: `adjust:${randomUUID()}`, type: 'MERCHANT_ADJUSTMENT', description: `${label}: ${reason}`, at, merchantId: o.merchantId, orderId: o.id as string, lines: merchantAdjustment(comp ? 'COMPENSATION' : 'DEDUCTION', o.merchantId, amount, `${label}: ${reason}`, o.id as string) });
    addDelta(o.merchantId, at, comp ? amount : -amount);
  }

  // Merchant cashouts on each merchant's cashout day at 10:00; paid at 15:00; today's stay pending.
  const cashouts: Prisma.CashoutRequestCreateManyInput[] = [];
  const minCashout = cfg['merchant.min_cashout_amount'] as number;
  for (const m of merchants) {
    const deltas = (merchantDeltas.get(m.id) ?? []).sort((a, b) => a.at - b.at);
    let paidOut = 0;
    const every = m.cashoutFrequency === 'DAILY' ? 1 : m.cashoutFrequency === 'EVERY_2_DAYS' ? 2 : 7;
    for (let d = 1; d <= DAYS; d++) {
      const day = windowStart + d * 24 * H;
      const dow = new Date(day + 12 * H).getUTCDay();
      if (every === 7 ? dow !== 0 : d % every !== 0) continue;
      const reqAt = day + 10 * H;
      if (reqAt > nowMs) break;
      const balance = deltas.filter((x) => x.at <= reqAt).reduce((s, x) => s + x.amount, 0) - paidOut;
      const bank = !!m.bankDetails;
      const method = bank ? 'BANK' : 'FAWRY_ACCOUNT';
      if (balance < Math.max(minCashout, egp(150))) continue;
      const fee = cashoutFee(method, balance, feeCfg);
      if (balance - fee <= 0) continue;
      const id = randomUUID();
      const paidAt = reqAt + 5 * H;
      const pending = paidAt > nowMs;
      const reference = `MOCK-${bank ? 'BANK' : 'FAWRY'}-${id.slice(0, 10).toUpperCase()}`;
      cashouts.push({
        id, merchantId: m.id, amount: balance, fee, netAmount: balance - fee, method, destination: bank ? `${m.bankDetails!.bankName} ${m.bankDetails!.iban.slice(0, 4)} •••• ${m.bankDetails!.iban.slice(-4)}` : phoneNumber(),
        status: pending ? 'PENDING' : 'PAID', auto: true, requestedById: null, decidedById: pending ? null : ops.id, decidedAt: pending ? null : new Date(paidAt), payoutReference: pending ? null : reference,
        createdAt: new Date(reqAt), updatedAt: new Date(pending ? reqAt : paidAt),
      });
      paidOut += balance;
      if (!pending) post({ key: `cashout:${id}`, type: 'MERCHANT_CASHOUT', description: `Cashout ${method} ${reference}`, at: paidAt, merchantId: m.id, lines: cashoutPaid(m.id, balance, fee), ref: ['cashout_request', id] });
    }
  }

  // Transfers and repeated failure alerts.
  const transfers: Prisma.TransferCreateManyInput[] = [];
  const transferItems: Prisma.TransferItemCreateManyInput[] = [];
  const hubCodeById = Object.fromEntries(hubs.map((h) => [h.id, h.code]));
  const dayCount = new Map<string, number>();
  const usedCodes = new Set((await db.transfer.findMany({ select: { code: true } })).map((x) => x.code));
  for (const tr of [...transferMap.values()].sort((a, b) => a.depart - b.depart)) {
    const dayKey = `${new Date(tr.depart).toISOString().slice(2, 10).replace(/-/g, '')}|${tr.origin}`;
    let n = (dayCount.get(dayKey) ?? 0) + 1;
    const codeOf = (k: number) => `TRF-${hubCodeById[tr.origin]}-${hubCodeById[tr.dest]}-${dayKey.split('|')[0]}-${k}`;
    while (usedCodes.has(codeOf(n))) n++;
    usedCodes.add(codeOf(n));
    dayCount.set(dayKey, n);
    const allIn = tr.orders.every((x) => x.arrived !== null);
    transfers.push({
      id: tr.id, code: codeOf(n), originHubId: tr.origin, destinationHubId: tr.dest,
      vehicle: pick(['Van 4512 ABC', 'Van 7741 KMN', 'Truck 1290 RSD', 'Van 3307 BTE']), status: allIn ? 'RECEIVED' : 'IN_TRANSIT', createdById: ops.id,
      createdAt: new Date(tr.depart - between(1, 3) * H), dispatchedAt: new Date(tr.depart), receivedAt: allIn ? new Date(Math.max(...tr.orders.map((x) => x.arrived!))) : null,
    });
    for (const it of tr.orders) transferItems.push({ transferId: tr.id, orderId: it.orderId, scannedOutAt: new Date(tr.depart - between(0.2, 1) * H), scannedInAt: it.arrived ? new Date(it.arrived) : null });
  }
  for (const o of orders.filter((x) => (x.attempts ?? 0) >= 1 && x.status === 'AWAITING_MERCHANT_ACTION')) {
    if (chance(0.4)) alerts.push({ kind: 'REPEATED_FAILURE', severity: 'MEDIUM', message: `${o.trackingNumber} failed (${o.lastFailedReason}) and is waiting for the merchant`, entityType: 'order', entityId: o.id as string, createdAt: o.updatedAt as Date });
  }

  // ───── write everything ─────
  console.log(`writing: ${orders.length} orders, ${events.length} events, ${journals.length} journals, ${transfers.length} transfers, ${cashouts.length} cashouts`);
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

  // Import batches for CSV orders: one per merchant per day.
  const batches = new Map<string, { id: string; merchantId: string; at: number; count: number; by: string | null }>();
  for (const o of orders.filter((x) => x.source === 'CSV')) {
    const k = `${o.merchantId}|${localMidnight(o.createdMs)}`;
    if (!batches.has(k)) batches.set(k, { id: randomUUID(), merchantId: o.merchantId, at: o.createdMs, count: 0, by: o.createdById as string | null });
    const b = batches.get(k)!;
    b.count++;
    o.importBatchId = b.id;
  }
  // One transaction: if anything fails nothing is written and the command can simply be run again.
  await db.$transaction(
    async (tx) => {
      await tx.importBatch.createMany({
        data: [...batches.values()].map((b) => ({ id: b.id, merchantId: b.merchantId, fileName: `orders-${new Date(b.at).toISOString().slice(0, 10)}.csv`, totalRows: b.count, successRows: b.count, errorRows: 0, createdById: b.by, createdAt: new Date(b.at) })),
      });
      await tx.cashHandover.createMany({ data: handovers });
      for (const part of chunk(orders, 400)) {
        await tx.order.createMany({ data: part.map(({ steps: _s, createdMs: _c, ...o }) => o) });
      }
      for (const part of chunk(events, 2000)) await tx.orderEvent.createMany({ data: part });
      await tx.transfer.createMany({ data: transfers });
      for (const part of chunk(transferItems, 2000)) await tx.transferItem.createMany({ data: part });

      // Journals in time order, then their lines (each batch holds complete journals so every commit balances).
      journals.sort((a, b) => a.at - b.at);
      const keyToId = new Map<string, bigint>();
      for (const part of chunk(journals, 1000)) {
        const rows = await tx.journalEntry.createManyAndReturn({
          data: part.map((j) => ({
            type: j.type, description: j.description, idempotencyKey: j.key, merchantId: j.merchantId ?? null, orderId: j.orderId ?? null,
            referenceType: j.ref?.[0] ?? null, referenceId: j.ref?.[1] ?? null, occurredAt: new Date(j.at), createdAt: new Date(j.at), createdById: ops.id,
          })),
          select: { id: true, idempotencyKey: true },
        });
        for (const r of rows) keyToId.set(r.idempotencyKey, r.id);
        await tx.ledgerEntry.createMany({
          data: part.flatMap((j) =>
            j.lines.map((l) => ({
              journalId: keyToId.get(j.key)!, accountCode: l.account, merchantId: l.merchantId ?? null, orderId: l.orderId ?? null, driverId: l.driverId ?? null,
              debit: l.debit ?? 0, credit: l.credit ?? 0, memo: l.memo ?? null, occurredAt: new Date(j.at),
            })),
          ),
        });
      }
      await tx.cashoutRequest.createMany({ data: cashouts.map((c) => ({ ...c, journalId: c.status === 'PAID' ? keyToId.get(`cashout:${c.id}`) ?? null : null })) });
      await tx.cashDeposit.createMany({ data: deposits.map((d) => ({ ...d, journalId: keyToId.get(`deposit:${d.reference}`)! })) });
      for (const h of handovers) await tx.cashHandover.update({ where: { id: h.id! }, data: { journalId: keyToId.get(`handover:${h.id}`) ?? null } });
      await tx.alert.createMany({ data: alerts });
      await tx.settlementRun.createMany({
        data: [...runs.entries()].map(([at, r]) => ({ asOf: new Date(at), status: 'DONE', ordersSettled: r.settled, ordersCharged: r.charged, cashoutsCreated: 0, triggeredBy: 'schedule', startedAt: new Date(at), finishedAt: new Date(at + 40_000) })),
      });
      await tx.$executeRawUnsafe(`SELECT setval('tracking_number_seq', ${trackingSeq})`);
      await tx.auditLog.create({ data: { actorRole: 'SYSTEM', action: 'demo.generate', entityType: 'system', after: { merchants: merchants.length, orders: orders.length, journals: journals.length } } });
    },
    { maxWait: 60_000, timeout: 900_000 },
  );

  // ───── summary ─────
  const counts = await db.order.groupBy({ by: ['status'], _count: true });
  const [tb] = await db.$queryRaw<{ d: bigint; c: bigint }[]>`SELECT sum(debit) d, sum(credit) c FROM ledger_entries`;
  console.log('orders by status:', Object.fromEntries(counts.map((c) => [c.status, c._count])));
  console.log(`ledger: debits ${Number(tb.d) / 100} EGP, credits ${Number(tb.c) / 100} EGP, balanced: ${tb.d === tb.c}`);
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s. Every merchant owner signs in with ${PASSWORD} (for example owner@bloomskincare.eg)`);
  await db.$disconnect();
}

function phoneNumber() {
  const p = pick(['10', '11', '12', '15']);
  return `+20${p}${String(Math.floor(rnd() * 1e8)).padStart(8, '0')}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
