import type { PrismaClient } from '@prisma/client';
import { passwordSchema, SETTING_DEFINITIONS, SETTING_KEYS, GLOBAL_SCOPE } from '@shiplynow/shared';
import { hashPassword } from '../password';
import { move, receive } from '../stock';
import { setZoneArea } from '../zones';
import {
  BINS,
  DEFAULT_HOURS,
  DEMO_USERS,
  ean13,
  GOVERNORATES,
  MERCHANT,
  openingStock,
  SKUS,
  STORE_GOVERNORATE_ID,
  STORES,
} from './data';

export interface SeedOptions {
  admin: { email: string; password: string; name: string };
  /** Password for the demo store staff and riders */
  demoPassword: string;
  log?: (message: string) => void;
}

/**
 * Loads the pilot reference and sample data. Safe to run any number of times: rows are
 * only created when missing, so anything edited in admin is never overwritten, and stock
 * goes in through the stock functions with idempotency keys.
 */
export async function seed(prisma: PrismaClient, options: SeedOptions) {
  const log = options.log ?? (() => undefined);
  passwordSchema.parse(options.admin.password);
  passwordSchema.parse(options.demoPassword);

  for (const g of GOVERNORATES) {
    await prisma.governorate.upsert({ where: { id: g.id }, update: {}, create: g });
  }
  log(`Governorates: ${GOVERNORATES.length}`);

  const adminEmail = options.admin.email.trim().toLowerCase();
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: options.admin.name,
      role: 'admin',
      passwordHash: await hashPassword(options.admin.password),
    },
  });
  log(`Admin: ${admin.email}`);

  for (const key of SETTING_KEYS) {
    const def = SETTING_DEFINITIONS[key];
    await prisma.setting.upsert({
      where: { key_scope: { key, scope: GLOBAL_SCOPE } },
      update: {},
      create: { key, scope: GLOBAL_SCOPE, value: def.default, description: def.description },
    });
  }
  log(`Settings: ${SETTING_KEYS.length}`);

  const stores = new Map<string, string>();
  for (const s of STORES) {
    const store = await prisma.darkStore.upsert({
      where: { code: s.code },
      update: {},
      create: {
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        addressEn: s.addressEn,
        addressAr: s.addressAr,
        latitude: s.latitude,
        longitude: s.longitude,
        governorateId: STORE_GOVERNORATE_ID,
      },
    });
    stores.set(s.code, store.id);

    for (let weekday = 0; weekday < 7; weekday++) {
      await prisma.storeHours.upsert({
        where: { darkStoreId_weekday: { darkStoreId: store.id, weekday } },
        update: {},
        create: { darkStoreId: store.id, weekday, ...DEFAULT_HOURS },
      });
    }

    for (const z of s.zones) {
      const zone = await prisma.zone.upsert({
        where: { darkStoreId_code: { darkStoreId: store.id, code: z.code } },
        update: {},
        create: {
          darkStoreId: store.id,
          code: z.code,
          nameEn: z.nameEn,
          nameAr: z.nameAr,
          governorateId: STORE_GOVERNORATE_ID,
        },
      });
      const [{ hasArea }] = (await prisma.$queryRaw<{ hasArea: boolean }[]>`
        SELECT area IS NOT NULL AS "hasArea" FROM zones WHERE id = ${zone.id}`) as [
        { hasArea: boolean },
      ];
      if (!hasArea) await setZoneArea(prisma, zone.id, z.area);
    }

    for (const b of BINS) {
      await prisma.bin.upsert({
        where: { darkStoreId_code: { darkStoreId: store.id, code: b.code } },
        update: {},
        create: { darkStoreId: store.id, code: b.code, type: b.type },
      });
    }
  }
  log(`Dark stores: ${STORES.map((s) => s.code).join(', ')}`);

  const merchant =
    (await prisma.merchant.findFirst({ where: { name: MERCHANT.name } })) ??
    (await prisma.merchant.create({ data: MERCHANT }));

  const skuIds: string[] = [];
  for (const [i, s] of SKUS.entries()) {
    const sku = await prisma.sku.upsert({
      where: { merchantId_sku: { merchantId: merchant.id, sku: s.sku } },
      update: {},
      create: {
        ...s,
        merchantId: merchant.id,
        barcode: ean13(`6221234${String(i + 1).padStart(5, '0')}`),
      },
    });
    skuIds.push(sku.id);
  }
  log(`Merchant: ${merchant.name} with ${SKUS.length} SKUs`);

  const demoHash = await hashPassword(options.demoPassword);
  for (const u of DEMO_USERS) {
    const darkStoreId = stores.get(u.storeCode)!;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        phone: u.phone,
        role: u.role,
        darkStoreId,
        passwordHash: demoHash,
      },
    });
    if (u.role === 'rider' && u.badgeCode) {
      await prisma.rider.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, darkStoreId, badgeCode: u.badgeCode },
      });
    }
  }
  log(`Demo users: ${DEMO_USERS.length}`);

  // Opening stock goes through the real stock functions: receive, then put away.
  let movements = 0;
  for (const s of STORES) {
    const darkStoreId = stores.get(s.code)!;
    const bins = await prisma.bin.findMany({ where: { darkStoreId } });
    const receiving = bins.find((b) => b.code === 'RCV-01')!;
    const shelves = bins
      .filter((b) => b.type === 'pickable')
      .sort((a, b) => a.code.localeCompare(b.code));
    for (const [i, skuId] of skuIds.entries()) {
      const quantity = openingStock(s.code, i);
      if (quantity === 0) continue;
      const sku = SKUS[i]!.sku;
      const received = await receive(prisma, {
        skuId,
        binId: receiving.id,
        quantity,
        actorUserId: admin.id,
        reason: 'opening_stock',
        idempotencyKey: `seed:receive:${s.code}:${sku}`,
      });
      const putAway = await move(prisma, {
        skuId,
        fromBinId: receiving.id,
        toBinId: shelves[i % shelves.length]!.id,
        quantity,
        actorUserId: admin.id,
        reason: 'put_away',
        idempotencyKey: `seed:putaway:${s.code}:${sku}`,
      });
      movements += Number(!received.replayed) + Number(!putAway.replayed);
    }
  }
  log(`Opening stock: ${movements} new movements`);

  return { adminId: admin.id, merchantId: merchant.id, stores };
}
