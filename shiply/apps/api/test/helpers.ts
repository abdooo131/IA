import 'reflect-metadata';
import { hash } from 'argon2';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createDb, seed } from '@shiply/db';
import { createApp } from '../src/app';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/shiply_test';
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';

export const db = createDb(TEST_URL);

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE location.address_decisions, location.phone_memory, location.area_services, location.delivery_zones, location.sites, location.taught_names, location.places, platform.event_deliveries, platform.outbox_events, platform.idempotency_records, platform.audit_log, platform.settings, platform.user_sites, platform.users, platform.role_access, platform.job_roles, platform.cost_centres, platform.companies CASCADE',
  );
  await seed(db, { SEED_ADMIN_EMAIL: 'owner@test.local', SEED_ADMIN_PASSWORD: 'owner-pass-1' });
  const viewer = await db.jobRole.findUniqueOrThrow({ where: { key: 'viewer' } });
  await db.user.create({
    data: {
      name: 'Viewer',
      nameAr: 'مشاهد',
      mobile: '+201012345678',
      passwordHash: await hash('viewer-pass-1'),
      roleId: viewer.id,
    },
  });
}

export async function startApp(): Promise<INestApplication> {
  const app = await createApp(db);
  await app.init();
  return app;
}

/** Signs in and returns the cookie header to send on later calls. */
export async function signIn(app: INestApplication, login: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ login, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.headers['set-cookie'] as unknown as string[];
}
