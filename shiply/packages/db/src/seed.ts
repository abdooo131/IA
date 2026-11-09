// Starting data. Safe to run any number of times: it only creates what is missing.
import { hash } from 'argon2';
import { TILES } from '@shiply/shared';
import { SEED_PLACES } from '@shiply/address';
import type { PrismaClient } from '@prisma/client';

interface SeedEnv {
  [key: string]: string | undefined;
  SEED_ADMIN_EMAIL?: string;
  SEED_ADMIN_PASSWORD?: string;
}

const COMPANIES = [
  { key: 'shiply_now', nameEn: 'Shiply Now', nameAr: 'شيبلي ناو' },
  { key: 'shiply', nameEn: 'Shiply', nameAr: 'شيبلي' },
];

const ROLES = [
  { key: 'owner', nameEn: 'Owner', nameAr: 'المالك', level: 'manage' },
  { key: 'viewer', nameEn: 'Viewer', nameAr: 'مشاهد', level: 'view' },
];

export async function seed(db: PrismaClient, env: SeedEnv = process.env) {
  for (const c of COMPANIES) {
    await db.company.upsert({ where: { key: c.key }, update: {}, create: c });
  }
  for (const r of ROLES) {
    const role = await db.jobRole.upsert({
      where: { key: r.key },
      update: {},
      create: { key: r.key, nameEn: r.nameEn, nameAr: r.nameAr },
    });
    for (const app of TILES) {
      await db.roleAccess.upsert({
        where: { roleId_app: { roleId: role.id, app } },
        update: {},
        create: { roleId: role.id, app, level: r.level },
      });
    }
  }
  // The place list for the address engine. Existing places keep any edits made in the system.
  const existing = new Set((await db.place.findMany({ select: { id: true } })).map((p) => p.id));
  const missing = SEED_PLACES.filter((p) => !existing.has(p.id));
  if (missing.length) {
    await db.place.createMany({
      data: missing.map((p) => ({
        id: p.id,
        kind: p.kind,
        parentId: p.parent ?? null,
        nameEn: p.en,
        nameAr: p.ar,
        names: p.names ?? [],
        needsParent: p.needsParent ?? false,
        served: p.served ?? true,
      })),
    });
  }
  const email = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required');
  const exists = await db.user.findUnique({ where: { email } });
  if (!exists) {
    const owner = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
    await db.user.create({
      data: { name: 'Admin', nameAr: 'المدير', email, passwordHash: await hash(password), roleId: owner.id },
    });
  }
}
