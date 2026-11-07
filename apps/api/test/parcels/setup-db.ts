// The parcel network's suites run against Shiply Now's test database like every other suite:
// each file empties it and loads Shiply Now's seed plus the whole parcel network (every
// governorate served, trucks between every facility, demo agents, hub staff, couriers, merchants).
import type { INestApplication } from '@nestjs/common';
import { seed } from '@shiplynow/db';
import { createTestApp, type Overrides } from '../helpers';

export const ADMIN_PASSWORD = 'admin12345';
export const DEMO_PASSWORD = 'demo123456';

/**
 * A fresh app on a freshly seeded database. Older suites hand parcels over without the
 * receiver's code and book pickups by hand; the driver suite keeps both on.
 */
export async function createNetworkApp(opts: { driver?: boolean } = {}, overrides: Overrides = {}): Promise<INestApplication> {
  process.env.SHIPLY_JOBS = 'off';
  const { app, prisma } = await createTestApp(overrides);
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seed(prisma, {
    areas: false,
    admin: { email: 'admin@shiply.local', password: ADMIN_PASSWORD, name: 'Admin' },
    demoPassword: DEMO_PASSWORD,
    network: true,
    networkDemo: true,
    networkEverywhere: true,
  });
  if (!opts.driver) {
    for (const key of ['delivery.code_required', 'pickups.auto_request']) {
      const id = { key: `parcels.${key}`, scope: 'global' };
      await prisma.setting.upsert({ where: { key_scope: id }, update: { value: 'OFF' }, create: { ...id, value: 'OFF' } });
    }
  }
  return app;
}
