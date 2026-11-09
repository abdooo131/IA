import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { seed } from '../src/seed';
import { SEED_PLACES } from '@shiply/address';

const db = createDb(process.env.TEST_DATABASE_URL);
beforeAll(() =>
  db.$executeRawUnsafe(
    'TRUNCATE money.expenses, money.bills, money.payouts, money.handovers, money.cash_holders, money.journal_lines, money.journal_entries,  merchants.shopify_shops, merchants.products, merchants.volume_tiers, merchants.parcel_prices, merchants.contract_versions, merchants.contracts, merchants.pricing_zone_areas, merchants.pricing_zones, merchants.merchant_users, merchants.merchants,  location.geocode_cache, location.address_decisions, location.phone_memory, location.area_services, location.delivery_zones, location.sites, location.taught_names, location.places, platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
  ),
);
afterAll(() => db.$disconnect());

describe('seed', () => {
  it('can run twice and changes nothing the second time', async () => {
    const env = { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'secret-pass-1' };
    await seed(db, env);
    await seed(db, env);
    expect(await db.company.count()).toBe(2);
    expect(await db.jobRole.count()).toBe(3);
    expect(await db.user.count({ where: { email: 'admin@test.local' } })).toBe(1);
    const owner = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' }, include: { access: true } });
    expect(owner.access).toHaveLength(12);
    expect(owner.access.every((a) => a.level === 'manage')).toBe(true);
  });

  it('loads the place list for the address engine', async () => {
    expect(await db.place.count()).toBe(SEED_PLACES.length);
    expect((await db.place.findUniqueOrThrow({ where: { id: 'maadi' } })).parentId).toBe('cairo');
  });

  it('has the merchants tables, empty at the start', async () => {
    expect(await db.merchant.count()).toBe(0);
  });
});
