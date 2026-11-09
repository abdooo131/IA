// Demo data for trying the system: made up merchants, couriers, customers and addresses, pushed
// through the real services and scans so every status, balance and gap is what real work would
// leave. Never real customer data.
import type { INestApplication } from '@nestjs/common';
import { hash } from 'argon2';
import type { PrismaClient } from '@shiply/db';
import { TILES, type AppId, type Level } from '@shiply/shared';
import { CashService } from '../money';
import { ParcelsService } from '../parcels';
import { ScanService } from '../parcels/scan.service';
import { BagsService } from '../parcels/bags.service';
import { FacilityService } from '../parcels/facility.service';
import { HubService } from '../parcels/hub.service';
import { RunsService } from '../parcels/runs.service';
import { SpendingController } from '../money/spending.controller';
import { processDue, publish, type SessionUser } from '../platform';

export const DEMO_PASSWORD = 'demo-pass-1';

const HUBS = [
  { code: 'NSR', nameEn: 'Nasr City hub', nameAr: 'مركز مدينة نصر', zones: [{ code: 'NSR-A', nameEn: 'Nasr City', nameAr: 'مدينة نصر', places: ['nasr-city', 'nozha'] }] },
  { code: 'HEL', nameEn: 'Heliopolis hub', nameAr: 'مركز مصر الجديدة', zones: [{ code: 'HEL-A', nameEn: 'Heliopolis', nameAr: 'مصر الجديدة', places: ['heliopolis'] }, { code: 'HEL-B', nameEn: 'New Cairo', nameAr: 'القاهرة الجديدة', places: ['new-cairo'] }] },
  { code: 'MAA', nameEn: 'Maadi hub', nameAr: 'مركز المعادي', zones: [{ code: 'MAA-A', nameEn: 'Maadi', nameAr: 'المعادي', places: ['maadi'] }] },
  { code: 'GIZ', nameEn: 'Giza hub', nameAr: 'مركز الجيزة', zones: [{ code: 'GIZ-A', nameEn: 'Dokki and Mohandessin', nameAr: 'الدقي والمهندسين', places: ['dokki', 'agouza'] }, { code: 'GIZ-B', nameEn: 'Haram', nameAr: 'الهرم', places: ['haram'] }] },
];

// Districts customers write, with the hub that serves them (Zamalek has no zone yet: no route).
const DISTRICTS = [
  { text: 'مدينة نصر', hub: 'NSR' },
  { text: 'مصر الجديدة', hub: 'HEL' },
  { text: 'التجمع الخامس', hub: 'HEL' },
  { text: 'المعادي', hub: 'MAA' },
  { text: 'الدقي', hub: 'GIZ' },
  { text: 'المهندسين', hub: 'GIZ' },
  { text: 'الهرم', hub: 'GIZ' },
];

const MERCHANTS = [
  { code: 'NOVA', name: 'Nova Fashion', contact: 'Dina Adel', pickup: 'nasr-city', services: ['shiply'] },
  { code: 'CKW', name: 'Cairo Kitchenware', contact: 'Tamer Fawzy', pickup: 'maadi', services: ['shiply'] },
  { code: 'LOTS', name: 'Lotus Beauty', contact: 'Rania Samy', pickup: 'heliopolis', services: ['shiply'] },
  { code: 'PHB', name: 'Pharaoh Books', contact: 'Karim Nabil', pickup: 'dokki', services: ['shiply'] },
  { code: 'ATL', name: 'Atlas Electronics', contact: 'Hossam Ezz', pickup: 'nasr-city', services: ['shiply'] },
  { code: 'GRB', name: 'Green Basket', contact: 'Salma Hany', pickup: 'maadi', services: ['shiply_now'] },
];

const COURIERS = [
  { name: 'Ahmed Saeed', nameAr: 'أحمد سعيد', zone: 'NSR-A' },
  { name: 'Mostafa Ali', nameAr: 'مصطفى علي', zone: 'NSR-A' },
  { name: 'Youssef Kamal', nameAr: 'يوسف كمال', zone: 'HEL-A' },
  { name: 'Omar Fathy', nameAr: 'عمر فتحي', zone: 'HEL-B' },
  { name: 'Mahmoud Gaber', nameAr: 'محمود جابر', zone: 'MAA-A' },
  { name: 'Ibrahim Tarek', nameAr: 'إبراهيم طارق', zone: 'GIZ-A' },
  { name: 'Hassan Reda', nameAr: 'حسن رضا', zone: 'GIZ-B' },
  { name: 'Khaled Magdy', nameAr: 'خالد مجدي', zone: 'MAA-A' },
];

const FIRST = ['سارة', 'منى', 'هبة', 'نورا', 'ياسمين', 'مريم', 'ريم', 'دعاء', 'محمد', 'أحمد', 'كريم', 'عمرو', 'شريف', 'طارق', 'هاني', 'وليد'];
const LAST = ['حسن', 'إبراهيم', 'عبد الله', 'مصطفى', 'السيد', 'فاروق', 'شوقي', 'رمضان', 'سليمان', 'عادل'];
const SIZES = ['small', 'small', 'small', 'medium', 'medium', 'large'];

/** A small fixed random so the demo is the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const today = () => new Date(new Date().toISOString().slice(0, 10));
const allAccess = (level: Level) => Object.fromEntries(TILES.map((t) => [t, level])) as Record<AppId, Level>;

export async function loadDemo(app: INestApplication, db: PrismaClient): Promise<{ loaded: boolean; message: string }> {
  if (await db.merchant.findUnique({ where: { code: 'NOVA' } })) return { loaded: false, message: 'Demo data is already loaded.' };
  const rand = rng(7);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const parcels = app.get(ParcelsService);
  const scans = app.get(ScanService);
  const cash = app.get(CashService);
  const pw = await hash(DEMO_PASSWORD);

  // ── people ──
  const ownerRole = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  const viewerRole = await db.jobRole.findUniqueOrThrow({ where: { key: 'viewer' } });
  const fieldRole = await db.jobRole.findUniqueOrThrow({ where: { key: 'field' } });
  const hany = await db.user.create({ data: { name: 'Hany Supervisor', nameAr: 'هاني المشرف', email: 'hany@shiply.local', passwordHash: pw, roleId: ownerRole.id } });
  const mariam = await db.user.create({ data: { name: 'Mariam Accountant', nameAr: 'مريم المحاسبة', email: 'mariam@shiply.local', passwordHash: pw, roleId: ownerRole.id } });
  await db.user.create({ data: { name: 'Samir Viewer', nameAr: 'سمير', email: 'samir@shiply.local', passwordHash: pw, roleId: viewerRole.id } });
  const boss: SessionUser = { id: hany.id, kind: 'staff', access: allAccess('manage') };

  // ── the network: one sorting facility feeding four hubs ──
  const obr = await db.site.create({ data: { kind: 'sorting_facility', code: 'OBR', nameEn: 'Obour sorting facility', nameAr: 'مركز فرز العبور' } });
  const hubs: Record<string, { id: string; zones: Record<string, string> }> = {};
  for (const h of HUBS) {
    const hub = await db.site.create({ data: { kind: 'last_mile_hub', code: h.code, nameEn: h.nameEn, nameAr: h.nameAr, sortingFacilityId: obr.id } });
    hubs[h.code] = { id: hub.id, zones: {} };
    for (const z of h.zones) {
      const zone = await db.deliveryZone.create({ data: { hubId: hub.id, code: z.code, nameEn: z.nameEn, nameAr: z.nameAr } });
      hubs[h.code]!.zones[z.code] = zone.id;
      for (const placeId of z.places) await db.areaService.upsert({ where: { placeId }, create: { placeId, zoneId: zone.id }, update: { zoneId: zone.id } });
    }
  }
  await db.userSite.createMany({ data: [obr.id, ...Object.values(hubs).map((h) => h.id)].map((siteId) => ({ userId: hany.id, siteId })) });

  // ── merchants with active contracts: Greater Cairo prices by size ──
  const gc = (await db.pricingZone.findUnique({ where: { code: 'GC' } })) ?? (await db.pricingZone.create({ data: { code: 'GC', nameEn: 'Greater Cairo', nameAr: 'القاهرة الكبرى' } }));
  for (const placeId of ['cairo', 'giza']) await db.pricingZoneArea.upsert({ where: { placeId }, create: { placeId, pricingZoneId: gc.id }, update: {} });
  const merchants: Record<string, string> = {};
  let n = 1;
  for (const m of MERCHANTS) {
    const merchant = await db.merchant.create({
      data: { code: m.code, name: m.name, contactName: m.contact, contactPhone: `+2010000000${String(n).padStart(2, '0')}`, services: m.services, status: 'approved', pickupPlaceId: m.pickup, pickupAddress: `Warehouse ${n}, ${m.pickup}` },
    });
    merchants[m.code] = merchant.id;
    const contract = await db.contract.create({ data: { merchantId: merchant.id, number: `C-DEMO-${n}` } });
    await db.contractVersion.create({
      data: {
        contractId: contract.id, version: 1, status: 'active', startDate: new Date('2026-01-01'), createdById: hany.id, approvedById: mariam.id, approvedAt: new Date(),
        codFeeBp: 100, returnFeeBp: 5000, openPackageFee: 500, deliveryAttempts: 3, deliveryFee: 3000,
        prices: { create: [['small', 4500], ['medium', 5500], ['large', 7000], ['light_bulky', 9000], ['heavy_bulky', 12000]].map(([size, price]) => ({ pricingZoneId: gc.id, size: size as string, price: price as number })) },
      },
    });
    n += 1;
  }

  // ── couriers (agent people) and their zones ──
  const couriers: { id: string; user: SessionUser; zone: string; hub: string }[] = [];
  for (const [i, c] of COURIERS.entries()) {
    const u = await db.user.create({ data: { name: c.name, nameAr: c.nameAr, mobile: `+2011000000${String(i + 1).padStart(2, '0')}`, kind: 'agent_person', passwordHash: pw, roleId: fieldRole.id } });
    const hub = HUBS.find((h) => h.zones.some((z) => z.code === c.zone))!.code;
    await db.courierZone.create({ data: { userId: u.id, zoneId: hubs[hub]!.zones[c.zone]! } });
    couriers.push({ id: u.id, user: { id: u.id, kind: 'agent_person', access: allAccess('none') }, zone: c.zone, hub });
  }

  // ── parcels: created through the real address engine ──
  const shiplyMerchants = MERCHANTS.filter((m) => m.services.includes('shiply'));
  const made: { id: string; tracking: string; merchant: string; cod: number }[] = [];
  for (let i = 0; i < 130; i++) {
    const m = shiplyMerchants[i % shiplyMerchants.length]!;
    const d = pick(DISTRICTS);
    const cod = Math.round(100 + rand() * 1400) * 100;
    const address = `${Math.floor(1 + rand() * 90)} شارع ${Math.floor(1 + rand() * 40)} ${d.text} الدور ${Math.floor(1 + rand() * 9)}`;
    const p = await db.$transaction((tx) =>
      parcels.create(tx, { merchantId: merchants[m.code]!, customerName: `${pick(FIRST)} ${pick(LAST)}`, phone: `+20109${String(1000000 + i).padStart(7, '0')}`, address, size: pick(SIZES), codAmount: cod, openPackage: rand() < 0.2, merchantRef: `${m.code}-${1000 + i}` }, hany.id),
    );
    made.push({ id: p.id, tracking: p.tracking, merchant: m.code, cod });
  }
  // A few addresses nobody can place yet: they wait in Needs location.
  for (const [i, address] of ['الحي السابع بجوار المسجد', 'عند الكوبري الجديد', 'المنطقة الصناعية الثالثة'].entries()) {
    await db.$transaction((tx) => parcels.create(tx, { merchantId: merchants.NOVA!, customerName: 'هالة محمود', phone: `+20112${String(2000000 + i).padStart(7, '0')}`, address, size: 'small', codAmount: 30000, openPackage: false }, hany.id));
  }

  const routed = (await db.parcel.findMany({ where: { id: { in: made.map((p) => p.id) }, hubId: { not: null }, price: { not: null } }, orderBy: { createdAt: 'asc' } })).map((p) => ({ ...p, hubCode: HUBS.find((h) => hubs[h.code]!.id === p.hubId)!.code }));
  const scan = (user: SessionUser, step: string, code: string, extra: Record<string, unknown> = {}) => scans.scan({ step, code, deviceScanId: crypto.randomUUID(), ...extra }, user);

  // The plan for the day: the first 15 stay created; the rest are picked up.
  const stage = (from: number, to: number) => routed.slice(from, to);
  const pickedUp = stage(15, routed.length);
  const pickups: Record<string, string> = {};
  for (const [i, m] of shiplyMerchants.entries()) {
    const c = couriers[i % couriers.length]!;
    const pk = await db.pickup.create({ data: { merchantId: merchants[m.code]!, date: today(), courierId: c.id, status: 'assigned', createdById: hany.id } });
    pickups[m.code] = pk.id;
  }
  const courierOf = (merchantCode: string) => couriers[shiplyMerchants.findIndex((m) => m.code === merchantCode) % couriers.length]!;
  for (const p of pickedUp) {
    const code = MERCHANTS.find((m) => merchants[m.code] === p.merchantId)!.code;
    await scan(courierOf(code).user, 'pickup', p.tracking, { pickupId: pickups[code] });
  }
  // 15 stay on the way (picked up); the rest arrive at inbound, except one that went missing.
  const arrived = pickedUp.slice(15);
  for (const p of arrived) await scan(boss, 'inbound', p.tracking, { siteId: obr.id });
  // One car was unloaded and closed with a parcel it never brought: a missing gap.
  const lost = await db.parcel.findUniqueOrThrow({ where: { id: pickedUp[0]!.id } });
  await app.get(FacilityService).closeInbound(obr.id, lost.pickupId!);

  // 10 stay at inbound; the rest are sorted.
  const sorted = arrived.slice(10);
  for (const p of sorted) await scan(boss, 'sorting', p.tracking, { siteId: obr.id });
  // 10 stay sorted; the rest go into one bag per hub and onto the night cars.
  const bagged = sorted.slice(10);
  const bags = app.get(BagsService);
  for (const code of Object.keys(hubs)) {
    const mine = bagged.filter((p) => p.hubCode === code);
    if (!mine.length) continue;
    const seal = `SEAL-${code}-001`;
    for (const p of mine) await scan(boss, 'outbound', p.tracking, { siteId: obr.id, bagSeal: seal });
    await bags.close(seal, hany.id);
    const car = await db.car.create({ data: { fromSiteId: obr.id, toSiteId: hubs[code]!.id, driverName: `Driver ${code}`, createdById: hany.id } });
    await scan(boss, 'car_load', seal, { siteId: obr.id, carId: car.id });
    await bags.depart(car.id, 1, hany.id);
  }
  // Every hub but Giza received its bag last night; Giza's car is still on the road.
  const hub = app.get(HubService);
  for (const code of ['NSR', 'HEL', 'MAA']) {
    const seal = `SEAL-${code}-001`;
    if (!(await db.bag.findUnique({ where: { seal } }))) continue;
    await scan(boss, 'hub_bag', seal, { siteId: hubs[code]!.id });
    for (const p of bagged.filter((x) => x.hubCode === code)) await scan(boss, 'hub_receive', p.tracking, { siteId: hubs[code]!.id, bagSeal: seal });
    await hub.bagDone(seal);
  }

  // Runs: each courier of those hubs takes parcels of his zone; some delivered, some failed.
  const runs = app.get(RunsService);
  const atHub = await db.parcel.findMany({ where: { status: 'at_hub' }, orderBy: { createdAt: 'asc' } });
  for (const c of couriers.filter((x) => ['NSR', 'HEL', 'MAA'].includes(x.hub))) {
    const zoneId = hubs[c.hub]!.zones[c.zone]!;
    const take = atHub.filter((p) => p.zoneId === zoneId && !p.courierId).slice(0, 6);
    if (!take.length) continue;
    const run = await runs.create(hubs[c.hub]!.id, c.id, hany.id);
    for (const p of take) {
      await scan(boss, 'dispatch', p.tracking, { siteId: hubs[c.hub]!.id, runId: run.id });
      p.courierId = c.id;
    }
    await runs.out(run.id);
    for (const [i, p] of take.entries()) {
      if (i < 3) await scan(c.user, 'deliver', p.tracking, { cash: p.codAmount, proof: 'otp' });
      else if (i === 3) await scan(c.user, 'fail', p.tracking, { reason: pick(['no_answer', 'refused', 'rescheduled']) });
      // the rest are still out for delivery
    }
  }
  // One parcel used all its attempts: on hold, going back to the merchant.
  const failedOnce = await db.parcel.findFirst({ where: { status: 'attempt_failed' } });
  if (failedOnce) {
    await db.parcel.update({ where: { id: failedOnce.id }, data: { attempts: 2 } });
    const c = couriers.find((x) => x.id === failedOnce.courierId)!;
    await scan(boss, 'dispatch', failedOnce.tracking, { siteId: failedOnce.hubId, runId: failedOnce.runId });
    await scan(c.user, 'fail', failedOnce.tracking, { reason: 'refused' });
  }

  // ── Shiply Now: Green Basket's orders delivered by a rider ──
  const rider = await db.cashHolder.create({ data: { kind: 'rider', nameEn: 'Ziad Rider', nameAr: 'زياد', companyKey: 'shiply_now', accountCode: '1201' } });
  for (let i = 0; i < 12; i++) {
    const amount = Math.round(150 + rand() * 600) * 100;
    await db.$transaction(async (tx) => {
      await publish(tx, 'cash.collected', { companyKey: 'shiply_now', holderId: rider.id, merchantId: merchants.GRB, amount, sourceType: 'order', sourceId: `DEMO-NOW-${i}` }, `demo:now:cash:${i}`);
      await publish(tx, 'fee.charged', { companyKey: 'shiply_now', merchantId: merchants.GRB, kind: 'delivery', amount: 3000, sourceType: 'order', sourceId: `DEMO-NOW-${i}` }, `demo:now:fee:${i}`);
    });
  }
  while ((await processDue(db)) > 0) {
    /* book every cash and fee event */
  }

  // ── money: banks, hub safes, a handover that came in short, approvals waiting ──
  const banks = {
    shiply: await db.cashHolder.create({ data: { kind: 'bank', nameEn: 'CIB Shiply', nameAr: 'البنك التجاري شيبلي', companyKey: 'shiply', accountCode: '1101' } }),
    shiply_now: await db.cashHolder.create({ data: { kind: 'bank', nameEn: 'CIB Shiply Now', nameAr: 'البنك التجاري شيبلي ناو', companyKey: 'shiply_now', accountCode: '1101' } }),
  };
  const safes: Record<string, string> = {};
  for (const h of HUBS) safes[h.code] = (await db.cashHolder.create({ data: { kind: 'hub_safe', nameEn: `${h.nameEn} safe`, nameAr: `خزنة ${h.nameAr}`, companyKey: 'shiply', accountCode: '1203' } })).id;
  const holders = await db.cashHolder.findMany({ where: { kind: 'courier' } });
  for (const [i, h] of holders.slice(0, 2).entries()) {
    const held = await cash.held(h.id);
    if (held <= 0) continue;
    const c = couriers.find((x) => x.id === h.refId)!;
    const ho = await cash.handOver(h.id, safes[c.hub]!, held, hany.id);
    await cash.confirm(ho.id, i === 0 ? held : held - 5000, mariam.id);
  }
  await db.payout.create({ data: { merchantId: merchants.NOVA!, companyKey: 'shiply', amount: 50000, method: 'bank', preparedById: hany.id } });
  await db.payout.create({ data: { merchantId: merchants.GRB!, companyKey: 'shiply_now', amount: 100000, method: 'bank', preparedById: mariam.id } });
  await db.bill.create({ data: { companyKey: 'shiply', payee: 'Obour Properties', number: 'RENT-11', date: today(), dueDate: new Date(Date.now() + 10 * 86_400_000), amount: 4500000, vat: 0, accountCode: '5401', preparedById: mariam.id } });
  const spending = app.get(SpendingController);
  const req = { user: { id: mariam.id, kind: 'staff', access: allAccess('manage') } } as never;
  await db.$transaction(async (tx) => {
    // the bank needs money before it pays an expense: the owner's capital
    await tx.journalEntry.create({ data: { companyKey: 'shiply', date: today(), memo: 'Owner capital', sourceType: 'demo', sourceId: 'capital', sourceKey: 'demo:capital', lines: { create: [{ accountCode: '1101', debit: 50_000_000, credit: 0, partyType: 'holder', partyId: banks.shiply.id }, { accountCode: '3101', debit: 0, credit: 50_000_000 }] } } });
  });
  await spending.createExpense({ companyKey: 'shiply', date: today().toISOString().slice(0, 10), accountCode: '5401', amount: '1,200', vat: '0', fromHolderId: banks.shiply.id, note: 'Internet for the Obour facility' }, req);
  return { loaded: true, message: `Demo data loaded: ${await db.parcel.count()} parcels, ${MERCHANTS.length} merchants, ${COURIERS.length} couriers.` };
}
