import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { seed } from '../src/seed';

const db = createDb(process.env.TEST_DATABASE_URL);
beforeAll(() =>
  db.$executeRawUnsafe(
    'TRUNCATE platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
  ),
);
afterAll(() => db.$disconnect());

describe('seed', () => {
  it('can run twice and changes nothing the second time', async () => {
    const env = { SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'secret-pass-1' };
    await seed(db, env);
    await seed(db, env);
    expect(await db.company.count()).toBe(2);
    expect(await db.jobRole.count()).toBe(2);
    expect(await db.user.count({ where: { email: 'admin@test.local' } })).toBe(1);
    const owner = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' }, include: { access: true } });
    expect(owner.access).toHaveLength(12);
    expect(owner.access.every((a) => a.level === 'manage')).toBe(true);
  });
});
