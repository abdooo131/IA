import { hash } from 'argon2';
import { createDb, seed } from '@shiply/db';

/** A fresh test database: owner, a viewer, and a user who can open only Reports. */
export default async function setup() {
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test');
  await db.$executeRawUnsafe(
    'TRUNCATE parcels.attempts, parcels.runs, parcels.courier_zones, parcels.gaps, parcels.cars, parcels.bags, parcels.recurring_pickups, parcels.pickups, parcels.scans, parcels.parcel_events, parcels.parcels, money.expenses, money.bills, money.payouts, money.handovers, money.cash_holders, money.journal_lines, money.journal_entries,  merchants.shopify_shops, merchants.products, merchants.volume_tiers, merchants.parcel_prices, merchants.contract_versions, merchants.contracts, merchants.pricing_zone_areas, merchants.pricing_zones, merchants.merchant_users, merchants.merchants,  location.geocode_cache, location.address_decisions, location.phone_memory, location.area_services, location.delivery_zones, location.sites, location.taught_names, location.places, platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
  );
  await seed(db, { SEED_ADMIN_EMAIL: 'owner@test.local', SEED_ADMIN_PASSWORD: 'owner-pass-1' });
  const viewer = await db.jobRole.findUniqueOrThrow({ where: { key: 'viewer' } });
  const limited = await db.jobRole.create({
    data: { key: 'reports_only', nameEn: 'Reports only', nameAr: 'تقارير فقط', access: { create: [{ app: 'reports', level: 'view' }] } },
  });
  await db.user.create({ data: { name: 'Viewer', nameAr: 'مشاهد', mobile: '+201012345678', passwordHash: await hash('viewer-pass-1'), roleId: viewer.id } });
  await db.user.create({ data: { name: 'Rana', nameAr: 'رنا', email: 'rana@test.local', passwordHash: await hash('rana-pass-1'), roleId: limited.id } });
  // A second admin (approves contracts the first one wrote), a pending sign up, a pricing zone.
  const ownerRole = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: ownerRole.id } });
  await db.merchant.create({ data: { code: 'WAIT', name: 'Waiting Shop', contactName: 'Ali', contactPhone: '+201112345678', services: ['shiply'], status: 'pending' } });
  const gc = await db.pricingZone.create({ data: { code: 'GC', nameEn: 'Greater Cairo', nameAr: 'القاهرة الكبرى' } });
  await db.pricingZoneArea.createMany({ data: [{ placeId: 'cairo', pricingZoneId: gc.id }, { placeId: 'giza', pricingZoneId: gc.id }] });
  // Money: a courier holding 1,000 EGP for Shiply, a bank for Shiply Now, and Nile Pantry with
  // 500 EGP collected and a 40 EGP fee (plus 14% VAT) in Shiply Now; a Shiply parcel fee for P&L.
  const nile = await db.merchant.create({ data: { code: 'NILE', name: 'Nile Pantry', contactName: 'Hoda', contactPhone: '+201222345678', services: ['shiply_now'], status: 'approved' } });
  const omar = await db.cashHolder.create({ data: { kind: 'courier', nameEn: 'Omar', nameAr: 'عمر', companyKey: 'shiply', accountCode: '1201' } });
  const rider = await db.cashHolder.create({ data: { kind: 'rider', nameEn: 'Ali', nameAr: 'علي', companyKey: 'shiply_now', accountCode: '1201' } });
  await db.cashHolder.create({ data: { kind: 'bank', nameEn: 'CIB Shiply Now', nameAr: 'البنك شيبلي ناو', companyKey: 'shiply_now', accountCode: '1101' } });
  const book = (key: string, companyKey: string, lines: { accountCode: string; debit: number; credit: number; partyType?: string; partyId?: string }[]) =>
    db.journalEntry.create({ data: { companyKey, date: new Date(), memo: key, sourceType: 'setup', sourceId: key, sourceKey: `setup:${key}`, lines: { create: lines } } });
  await book('omar', 'shiply', [{ accountCode: '1201', debit: 100000, credit: 0, partyType: 'holder', partyId: omar.id }, { accountCode: '2101', debit: 0, credit: 100000, partyType: 'merchant', partyId: nile.id }]);
  await book('cod', 'shiply_now', [{ accountCode: '1201', debit: 50000, credit: 0, partyType: 'holder', partyId: rider.id }, { accountCode: '2101', debit: 0, credit: 50000, partyType: 'merchant', partyId: nile.id }]);
  await book('fee', 'shiply_now', [
    { accountCode: '2101', debit: 4560, credit: 0, partyType: 'merchant', partyId: nile.id },
    { accountCode: '4101', debit: 0, credit: 4000, partyType: 'merchant', partyId: nile.id },
    { accountCode: '2301', debit: 0, credit: 560, partyType: 'merchant', partyId: nile.id },
  ]);
  await book('parcel-fee', 'shiply', [{ accountCode: '2101', debit: 3000, credit: 0, partyType: 'merchant', partyId: nile.id }, { accountCode: '4301', debit: 0, credit: 3000, partyType: 'merchant', partyId: nile.id }]);
  // Parcels: a facility and a hub on Heliopolis, Eve Store priced at 45 EGP, courier Karim covering
  // the zone, and one pickup on the way to the facility with one parcel.
  const hlf = await db.site.create({ data: { kind: 'sorting_facility', code: 'HLF', nameEn: 'Helio facility', nameAr: 'مركز فرز مصر الجديدة' } });
  const hel = await db.site.create({ data: { kind: 'last_mile_hub', code: 'HEL', nameEn: 'Helio hub', nameAr: 'مركز مصر الجديدة', sortingFacilityId: hlf.id } });
  const zone = await db.deliveryZone.create({ data: { hubId: hel.id, code: 'HEL-A', nameEn: 'Helio A', nameAr: 'مصر الجديدة أ' } });
  await db.areaService.create({ data: { placeId: 'heliopolis', zoneId: zone.id } });
  const ownerUser = await db.user.findFirstOrThrow({ where: { email: 'owner@test.local' } });
  const eve = await db.merchant.create({ data: { code: 'EVE', name: 'Eve Store', contactName: 'Mona', contactPhone: '+201012345679', services: ['shiply'], status: 'approved', pickupPlaceId: 'heliopolis', pickupAddress: 'Heliopolis' } });
  const contract = await db.contract.create({ data: { merchantId: eve.id, number: 'C-E2E' } });
  await db.contractVersion.create({ data: { contractId: contract.id, version: 1, status: 'active', startDate: new Date('2026-01-01'), createdById: ownerUser.id, prices: { create: [{ pricingZoneId: gc.id, size: 'small', price: 4500 }] } } });
  const field = await db.jobRole.findUniqueOrThrow({ where: { key: 'field' } });
  const karim = await db.user.create({ data: { name: 'Karim', nameAr: 'كريم', mobile: '+201155555555', kind: 'agent_person', passwordHash: await hash('karim-pass-1'), roleId: field.id } });
  await db.courierZone.create({ data: { userId: karim.id, zoneId: zone.id } });
  const pickup = await db.pickup.create({ data: { merchantId: eve.id, date: new Date(new Date().toISOString().slice(0, 10)), courierId: karim.id, status: 'on_the_way', createdById: ownerUser.id } });
  await db.parcel.create({ data: { tracking: 'SP1000000009', merchantId: eve.id, customerName: 'Laila', phone: '+201001112223', addressText: 'روكسي', placeId: 'roxy', zoneId: zone.id, hubId: hel.id, facilityId: hlf.id, originFacilityId: hlf.id, size: 'small', price: 4500, status: 'picked_up', pickupId: pickup.id, createdById: ownerUser.id } });
  // Phone screens: one parcel waiting to be sorted at HLF, and courier Nour out on a run with one
  // parcel to deliver (250 EGP cash).
  const base = { merchantId: eve.id, customerName: 'Laila', phone: '+201001112223', addressText: 'روكسي', placeId: 'roxy', zoneId: zone.id, hubId: hel.id, facilityId: hlf.id, originFacilityId: hlf.id, size: 'small', price: 4500, createdById: ownerUser.id };
  await db.parcel.create({ data: { ...base, tracking: 'SP2000000001', status: 'at_inbound' } });
  const nour = await db.user.create({ data: { name: 'Nour', nameAr: 'نور', mobile: '+201166666666', kind: 'agent_person', passwordHash: await hash('nour-pass-1'), roleId: field.id } });
  const run = await db.run.create({ data: { hubId: hel.id, courierId: nour.id, date: new Date(new Date().toISOString().slice(0, 10)), status: 'out', confirmedById: ownerUser.id } });
  await db.parcel.create({ data: { ...base, tracking: 'SP5000000004', status: 'at_inbound', direction: 'return' } });
  await db.pickup.create({ data: { merchantId: eve.id, date: new Date(new Date().toISOString().slice(0, 10)), courierId: nour.id, status: 'assigned', createdById: ownerUser.id } });
  await db.parcel.create({ data: { ...base, tracking: 'SP4000000003', status: 'out_for_delivery', codAmount: 25000, courierId: nour.id, runId: run.id } });
  // One unclear address waiting in the Needs location queue.
  await db.addressDecision.create({
    data: {
      service: 'shiply', refType: 'parcel', refId: 'SH-E2E-1', input: 'الحي السابع', status: 'unsure', confidence: 50, method: 'engine',
      candidates: [{ id: 'nasr-city-hay-7', label: 'District 7, Nasr City, Cairo', score: 1.5 }, { id: 'october-hay-7', label: 'District 7, 6th of October, Giza', score: 1.5 }],
    },
  });
  await db.$disconnect();
}
