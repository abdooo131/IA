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

/** A tiny PDF standing in for a bank transfer slip. */
export const slipPdf = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/**
 * Makes a draft payout payable: uploads its proof of transfer (amount and reference typed
 * from the slip) and has a second person, never the payer, tick every active payout check.
 */
export async function readyToPay(
  payoutId: string,
  opts: { uploaderId: string; viewerId?: string; reference?: string },
) {
  const { addPayoutProof, listPayoutChecks, markPayoutCheck } = await import('../src/finance');
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  const viewerId =
    opts.viewerId ??
    (
      await prisma.user.create({
        data: {
          email: `viewer-${Math.random().toString(36).slice(2)}@t.eg`,
          name: 'Second person',
          role: 'finance',
          passwordHash: 'x',
        },
      })
    ).id;
  await addPayoutProof(prisma, {
    payoutId,
    fileName: 'slip.pdf',
    contentType: 'application/pdf',
    data: slipPdf(),
    amountPiastres: payout.amountPiastres,
    reference: opts.reference ?? `TRF-${payout.number}`,
    actorUserId: opts.uploaderId,
  });
  for (const check of await listPayoutChecks(prisma, { activeOnly: true }))
    await markPayoutCheck(prisma, { payoutId, checkId: check.id, actorUserId: viewerId });
  return { viewerId };
}
