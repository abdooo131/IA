import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Empties every app table. TRUNCATE skips the append only triggers, which are row level. */
export async function resetDatabase() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** One store with one bin of each type, one merchant and two SKUs. */
export async function createFixture() {
  await prisma.governorate.create({
    data: { id: 1, code: 'EG-C', nameEn: 'Cairo', nameAr: 'القاهرة' },
  });
  const store = await prisma.darkStore.create({
    data: {
      code: 'TST',
      nameEn: 'Test',
      nameAr: 'تجربة',
      addressEn: 'x',
      addressAr: 'x',
      governorateId: 1,
      latitude: 30,
      longitude: 31,
    },
  });
  const other = await prisma.darkStore.create({
    data: {
      code: 'OTH',
      nameEn: 'Other',
      nameAr: 'تاني',
      addressEn: 'x',
      addressAr: 'x',
      governorateId: 1,
      latitude: 30,
      longitude: 31,
    },
  });
  const bin = (
    code: string,
    type: 'receiving' | 'pickable' | 'damaged' | 'held',
    darkStoreId = store.id,
  ) => prisma.bin.create({ data: { darkStoreId, code, type } });
  const merchant = await prisma.merchant.create({ data: { name: 'Merchant' } });
  const sku = (code: string) =>
    prisma.sku.create({
      data: {
        merchantId: merchant.id,
        sku: code,
        titleEn: code,
        titleAr: code,
        pricePiastres: 1000,
      },
    });

  return {
    store,
    other,
    receiving: await bin('RCV', 'receiving'),
    shelfA: await bin('A-01', 'pickable'),
    shelfB: await bin('A-02', 'pickable'),
    damaged: await bin('DMG', 'damaged'),
    otherShelf: await bin('A-01', 'pickable', other.id),
    merchant,
    sku: await sku('SKU-1'),
    sku2: await sku('SKU-2'),
  };
}

export async function level(darkStoreId: string, skuId: string) {
  const row = await prisma.stockLevel.findUnique({
    where: { darkStoreId_skuId: { darkStoreId, skuId } },
  });
  return row ? { onHand: row.onHand, reserved: row.reserved } : null;
}

export async function binQty(binId: string, skuId: string) {
  const row = await prisma.binStock.findUnique({ where: { binId_skuId: { binId, skuId } } });
  return row?.quantity ?? 0;
}
