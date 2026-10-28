import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashPassword, type Role, seed } from '@shiplynow/db';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { Geocoder } from '../src/coverage/geocoding';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShopifyAdmin } from '../src/shopify/shopify-admin';
import { setupApp } from '../src/setup-app';

export interface Overrides {
  clock?: Clock;
  geocoder?: Geocoder;
  shopify?: ShopifyAdmin;
}

export async function createTestApp(
  overrides: Overrides = {},
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrides.clock) builder = builder.overrideProvider(Clock).useValue(overrides.clock);
  if (overrides.geocoder) builder = builder.overrideProvider(Geocoder).useValue(overrides.geocoder);
  if (overrides.shopify)
    builder = builder.overrideProvider(ShopifyAdmin).useValue(overrides.shopify);
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
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  return seed(prisma, {
    areas: false,
    admin: { email: 'admin@test.eg', password: 'admin-password-1', name: 'Admin' },
    demoPassword: 'demo-password-1',
  });
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

export async function createUser(
  prisma: PrismaService,
  data: { email: string; password: string; role: Role; name?: string; isActive?: boolean },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email,
      role: data.role,
      isActive: data.isActive ?? true,
      passwordHash: await hashPassword(data.password),
    },
  });
}

/** Pulls the value of one cookie out of a Set-Cookie header list. */
export function cookieValue(setCookie: string[] | string | undefined, name: string) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const match = list.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}
