import { hash } from 'argon2';
import { createDb, seed } from '@shiply/db';

/** A fresh test database: owner, a viewer, and a user who can open only Reports. */
export default async function setup() {
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test');
  await db.$executeRawUnsafe(
    'TRUNCATE platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
  );
  await seed(db, { SEED_ADMIN_EMAIL: 'owner@test.local', SEED_ADMIN_PASSWORD: 'owner-pass-1' });
  const viewer = await db.jobRole.findUniqueOrThrow({ where: { key: 'viewer' } });
  const limited = await db.jobRole.create({
    data: { key: 'reports_only', nameEn: 'Reports only', nameAr: 'تقارير فقط', access: { create: [{ app: 'reports', level: 'view' }] } },
  });
  await db.user.create({ data: { name: 'Viewer', nameAr: 'مشاهد', mobile: '+201012345678', passwordHash: await hash('viewer-pass-1'), roleId: viewer.id } });
  await db.user.create({ data: { name: 'Rana', nameAr: 'رنا', email: 'rana@test.local', passwordHash: await hash('rana-pass-1'), roleId: limited.id } });
  await db.$disconnect();
}
