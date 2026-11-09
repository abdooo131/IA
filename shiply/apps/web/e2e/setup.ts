import { hash } from 'argon2';
import { createDb, seed } from '@shiply/db';

/** A fresh test database: owner, a viewer, and a user who can open only Reports. */
export default async function setup() {
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test');
  await db.$executeRawUnsafe(
    'TRUNCATE merchants.shopify_shops, merchants.products, merchants.volume_tiers, merchants.parcel_prices, merchants.contract_versions, merchants.contracts, merchants.pricing_zone_areas, merchants.pricing_zones, merchants.merchant_users, merchants.merchants,  location.geocode_cache, location.address_decisions, location.phone_memory, location.area_services, location.delivery_zones, location.sites, location.taught_names, location.places, platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
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
  // One unclear address waiting in the Needs location queue.
  await db.addressDecision.create({
    data: {
      service: 'shiply', refType: 'parcel', refId: 'SH-E2E-1', input: 'الحي السابع', status: 'unsure', confidence: 50, method: 'engine',
      candidates: [{ id: 'nasr-city-hay-7', label: 'District 7, Nasr City, Cairo', score: 1.5 }, { id: 'october-hay-7', label: 'District 7, 6th of October, Giza', score: 1.5 }],
    },
  });
  await db.$disconnect();
}
