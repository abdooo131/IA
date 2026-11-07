import { cairoDay } from '@shiplynow/shared';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashPassword, type Role, seed, writeAccess } from '@shiplynow/db';
import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { Overpass } from '../src/coverage/geo-import.service';
import { Slack } from '../src/tickets/slack';
import { EtaClient } from '../src/finance/eta';
import { Geocoder } from '../src/coverage/geocoding';
import { PrismaService } from '../src/prisma/prisma.service';
import { PushSender } from '../src/push/push-sender';
import { Mailer } from '../src/email/mailer';
import { ShopifyAdmin } from '../src/shopify/shopify-admin';
import { setupApp } from '../src/setup-app';

export interface Overrides {
  clock?: Clock;
  geocoder?: Geocoder;
  shopify?: ShopifyAdmin;
  overpass?: Overpass;
  slack?: Slack;
  eta?: EtaClient;
  push?: PushSender;
  mailer?: Mailer;
}

export async function createTestApp(
  overrides: Overrides = {},
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides.clock) builder = builder.overrideProvider(Clock).useValue(overrides.clock);
  if (overrides.geocoder) builder = builder.overrideProvider(Geocoder).useValue(overrides.geocoder);
  if (overrides.shopify)
    builder = builder.overrideProvider(ShopifyAdmin).useValue(overrides.shopify);
  if (overrides.eta) builder = builder.overrideProvider(EtaClient).useValue(overrides.eta);
  if (overrides.slack) builder = builder.overrideProvider(Slack).useValue(overrides.slack);
  if (overrides.push) builder = builder.overrideProvider(PushSender).useValue(overrides.push);
  if (overrides.mailer) builder = builder.overrideProvider(Mailer).useValue(overrides.mailer);
  if (overrides.overpass) builder = builder.overrideProvider(Overpass).useValue(overrides.overpass);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE refresh_tokens, users CASCADE');
}

/** Empties every table, then loads the full seed (stores, zones, stock, users). */
export async function resetAndSeed(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  const truncate = `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`;
  // Background work a test started (a Shopify store's setup after connecting) may still be
  // writing; Postgres then stops one side as a deadlock. Emptying the tables again succeeds.
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$executeRawUnsafe(truncate);
      break;
    } catch (error) {
      const deadlock = (error as { meta?: { code?: string } }).meta?.code === '40P01';
      if (!deadlock || attempt >= 5) throw error;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  const seeded = await seed(prisma, {
    areas: false,
    admin: { email: 'admin@test.eg', password: 'admin-password-1', name: 'Admin' },
    demoPassword: 'demo-password-1',
  });
  // A fresh database always gets the sample merchant (only a fresh start leaves it out).
  return { ...seeded, merchantId: seeded.merchantId! };
}

/** A clock tests can move. */
export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  now() {
    return this.current;
  }
  set(date: Date) {
    this.current = date;
  }
}

/** Gives a team member a job role's access (docs/ACCESS.md). */
export function grantAccess(
  prisma: PrismaService,
  userId: string,
  jobRole: JobRole,
  storeIds: string[] = [],
) {
  return prisma.$transaction((tx) =>
    writeAccess(tx, userId, { ...JOB_ROLE_TEMPLATES[jobRole], jobRole }, storeIds),
  );
}

/** A user made straight in the database; admins get the Owner profile, finance Finance manager. */
export async function createUser(
  prisma: PrismaService,
  data: { email: string; password: string; role: Role; name?: string; isActive?: boolean },
) {
  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email,
      role: data.role,
      isActive: data.isActive ?? true,
      passwordHash: await hashPassword(data.password),
    },
  });
  if (data.role === 'admin') await grantAccess(prisma, user.id, 'owner');
  if (data.role === 'finance') await grantAccess(prisma, user.id, 'finance_manager');
  return user;
}

/** Pulls the value of one cookie out of a Set-Cookie header list. */
export function cookieValue(setCookie: string[] | string | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = list.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

/**
 * Gives a merchant its own prices through a contract version activated today (merchant
 * contracts v2: a merchant's own price lives in the contract, never in settings).
 */
export async function contractPrices(
  admin: {
    post: (url: string) => {
      send: (body: object) => { expect: (s: number) => Promise<{ body: { id: string } }> };
    };
  },
  merchantId: string,
  prices: Record<string, number>,
) {
  const today = cairoDay(new Date());
  const draft = await admin
    .post(`/admin/merchants/${merchantId}/contract/versions`)
    .send({
      orderFixedPiastres: null,
      orderPercentBp: null,
      codPercentBp: null,
      failedDeliveryPiastres: null,
      receivingPerUnitPiastres: null,
      storagePerUnitMonthPiastres: null,
      returnPerUnitPiastres: null,
      payoutSchedule: null,
      minimumPayoutPiastres: null,
      minimumMonthlyFeePiastres: null,
      securityDepositPiastres: null,
      creditLimitPiastres: null,
      promiseMinutes: null,
      deliveryAttempts: null,
      startDate: today,
      endDate: null,
      noticeDays: 30,
      tiers: [],
      ...prices,
    })
    .expect(201);
  await admin
    .post(`/admin/merchants/${merchantId}/contract/versions/${draft.body.id}/activate`)
    .send({ effectiveFrom: today })
    .expect(201);
}
