import type { BinType, Prisma, ReturnStatus, StockSource } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { postReturnFee } from './finance/postings';
import { notifyMerchant } from './notifications';
import { dispatch, release, reserve, StockError } from './stock';

// Stock back to the merchant (outbound). The merchant asks for units; sellable units are
// reserved at once so no order can sell them. Staff pick by scan, each unit leaving its bin
// through a dispatch movement, and hand the parcel to whoever collects it. While nothing is
// picked the merchant (or admin) can still cancel, which releases the reservations.
//
//   requested ──pick──▶ picking ──last unit──▶ ready ──hand over──▶ collected
//       │
//       └──cancel──▶ cancelled (only before the first unit is picked)

type Tx = Prisma.TransactionClient;

const BIN_OF: Record<StockSource, BinType> = {
  sellable: 'pickable',
  damaged: 'damaged',
  held: 'held',
};
const SOURCE_OF: Partial<Record<BinType, StockSource>> = {
  pickable: 'sellable',
  damaged: 'damaged',
  held: 'held',
};
const OPEN: ReturnStatus[] = ['requested', 'picking', 'ready'];

export interface CreateReturnInput {
  merchantId: string;
  darkStoreId: string;
  note?: string;
  lines: { skuId: string; source: StockSource; quantity: number }[];
  actorUserId: string;
}

async function lockReturn(tx: Tx, returnId: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM merchant_returns WHERE id = ${returnId} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError('return_not_found', 404);
  return tx.merchantReturn.findUniqueOrThrow({
    where: { id: returnId },
    include: { lines: true },
  });
}

/**
 * Units of one product in this store's bins of one type that no open return has claimed yet.
 * Sellable units are protected by reservations instead, so this is only for damaged and held.
 */
async function unclaimed(tx: Tx, darkStoreId: string, skuId: string, source: StockSource) {
  const [inBins, claimed] = await Promise.all([
    tx.binStock.aggregate({
      _sum: { quantity: true },
      where: { skuId, bin: { darkStoreId, type: BIN_OF[source], isActive: true } },
    }),
    tx.merchantReturnLine.findMany({
      where: { skuId, source, return: { darkStoreId, status: { in: OPEN } } },
      select: { quantity: true, pickedQty: true },
    }),
  ]);
  const open = claimed.reduce((s, l) => s + l.quantity - l.pickedQty, 0);
  return (inBins._sum.quantity ?? 0) - open;
}

/** What a merchant could take back from one store: sellable, damaged and held units per product. */
export async function returnableStock(db: Db, merchantId: string, darkStoreId: string) {
  const skus = await db.sku.findMany({
    where: { merchantId },
    include: {
      stockLevels: { where: { darkStoreId } },
      binStock: {
        where: { bin: { darkStoreId, type: { in: ['damaged', 'held'] } } },
        include: { bin: true },
      },
    },
    orderBy: { sku: 'asc' },
  });
  const claimed = await db.merchantReturnLine.findMany({
    where: {
      sku: { merchantId },
      source: { not: 'sellable' },
      return: { darkStoreId, status: { in: OPEN } },
    },
    select: { skuId: true, source: true, quantity: true, pickedQty: true },
  });
  const open = (skuId: string, source: StockSource) =>
    claimed
      .filter((l) => l.skuId === skuId && l.source === source)
      .reduce((s, l) => s + l.quantity - l.pickedQty, 0);
  const inBins = (sku: (typeof skus)[number], type: BinType) =>
    sku.binStock.filter((b) => b.bin.type === type).reduce((s, b) => s + b.quantity, 0);
  return skus
    .map((sku) => {
      const level = sku.stockLevels[0];
      return {
        skuId: sku.id,
        sku: sku.sku,
        titleEn: sku.titleEn,
        titleAr: sku.titleAr,
        sellable: level ? level.onHand - level.reserved : 0,
        damaged: inBins(sku, 'damaged') - open(sku.id, 'damaged'),
        held: inBins(sku, 'held') - open(sku.id, 'held'),
      };
    })
    .filter((r) => r.sellable > 0 || r.damaged > 0 || r.held > 0);
}

/** The merchant asks for units back. Sellable ones are reserved in the same transaction. */
export function createReturn(db: Db, input: CreateReturnInput) {
  return inTransaction(db, async (tx) => {
    const store = await tx.darkStore.findUnique({ where: { id: input.darkStoreId } });
    if (!store) throw new DomainError('dark_store_not_found', 404);
    const keys = input.lines.map((l) => `${l.skuId}:${l.source}`);
    if (new Set(keys).size !== keys.length) throw new DomainError('duplicate_sku', 400);
    if (input.lines.length === 0) throw new DomainError('no_lines', 400);
    const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
    const owned = await tx.sku.count({
      where: { id: { in: skuIds }, merchantId: input.merchantId },
    });
    if (owned !== skuIds.length) throw new DomainError('sku_not_found', 400);

    // One merchant numbers returns one at a time: RET-1001, RET-1002, ...
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
    const count = await tx.merchantReturn.count({ where: { merchantId: input.merchantId } });
    const ret = await tx.merchantReturn.create({
      data: {
        reference: `RET-${1001 + count}`,
        merchantId: input.merchantId,
        darkStoreId: input.darkStoreId,
        note: input.note?.trim() || null,
        createdById: input.actorUserId,
        lines: { create: input.lines },
      },
      include: { lines: true },
    });

    for (const line of input.lines) {
      if (line.source === 'sellable') {
        try {
          await reserve(tx, {
            darkStoreId: input.darkStoreId,
            skuId: line.skuId,
            quantity: line.quantity,
            reason: `return_to_merchant:${ret.id}`,
            actorUserId: input.actorUserId,
          });
        } catch (error) {
          if (error instanceof StockError) throw new DomainError('not_enough_available');
          throw error;
        }
      } else {
        // The new line itself is already counted as claimed.
        if ((await unclaimed(tx, input.darkStoreId, line.skuId, line.source)) < 0)
          throw new DomainError('not_enough_available');
      }
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'return.create',
      entityType: 'merchant_return',
      entityId: ret.id,
      after: { reference: ret.reference, darkStoreId: ret.darkStoreId, lines: input.lines },
    });
    return ret;
  });
}

export interface PickReturnInput {
  returnId: string;
  darkStoreId: string;
  skuId: string;
  /** The bin scanned first, or none to take from the first bin that has the units */
  binId?: string;
  quantity: number;
  actorUserId: string;
  idempotencyKey: string;
}

/** Staff take units for a return off a bin. The last unit makes the return ready. */
export function pickForReturn(db: Db, input: PickReturnInput) {
  return inTransaction(db, async (tx) => {
    const seen = await tx.stockMovement.findUnique({
      where: { idempotencyKey: `return-pick:${input.idempotencyKey}` },
    });
    const ret = await lockReturn(tx, input.returnId);
    if (ret.darkStoreId !== input.darkStoreId) throw new DomainError('return_not_found', 404);
    if (seen) return { status: ret.status, replayed: true };
    if (ret.status !== 'requested' && ret.status !== 'picking')
      throw new DomainError('invalid_return_state');

    const scanned = input.binId ? await tx.bin.findUnique({ where: { id: input.binId } }) : null;
    if (input.binId && (!scanned || scanned.darkStoreId !== ret.darkStoreId))
      throw new DomainError('bin_not_found', 404);
    const wanted = scanned ? SOURCE_OF[scanned.type] : undefined;
    if (scanned && !wanted) throw new DomainError('bin_not_allowed', 400);
    const line = ret.lines.find(
      (l) =>
        l.skuId === input.skuId &&
        l.quantity - l.pickedQty >= input.quantity &&
        (!wanted || l.source === wanted),
    );
    if (!line) {
      throw new DomainError(
        ret.lines.some((l) => l.skuId === input.skuId) ? 'over_pick' : 'sku_not_on_return',
      );
    }

    const bin =
      scanned ??
      (await tx.bin.findFirst({
        where: {
          darkStoreId: ret.darkStoreId,
          type: BIN_OF[line.source],
          isActive: true,
          stock: { some: { skuId: input.skuId, quantity: { gte: input.quantity } } },
        },
        orderBy: { code: 'asc' },
      }));
    if (!bin) throw new DomainError('not_on_shelf');
    try {
      await dispatch(tx, {
        binId: bin.id,
        skuId: input.skuId,
        quantity: input.quantity,
        returnId: ret.id,
        reason: 'return_to_merchant',
        actorUserId: input.actorUserId,
        idempotencyKey: `return-pick:${input.idempotencyKey}`,
      });
    } catch (error) {
      if (error instanceof StockError && error.code === 'insufficient_bin_stock')
        throw new DomainError('not_on_shelf');
      throw error;
    }
    await tx.merchantReturnLine.update({
      where: { id: line.id },
      data: { pickedQty: { increment: input.quantity } },
    });
    const done = ret.lines.every(
      (l) => l.pickedQty + (l.id === line.id ? input.quantity : 0) === l.quantity,
    );
    const status: ReturnStatus = done ? 'ready' : 'picking';
    await tx.merchantReturn.update({
      where: { id: ret.id },
      data: { status, ...(done && { readyAt: new Date() }) },
    });
    return { status, bin: bin.code, replayed: false };
  });
}

/** Whoever collects for the merchant signs for the parcel. The return fee is charged here. */
export function handOverReturn(
  db: Db,
  input: {
    returnId: string;
    darkStoreId: string;
    collectedBy: string;
    actorUserId: string;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const ret = await lockReturn(tx, input.returnId);
    if (ret.darkStoreId !== input.darkStoreId) throw new DomainError('return_not_found', 404);
    if (ret.status !== 'ready') throw new DomainError('invalid_return_state');
    await tx.merchantReturn.update({
      where: { id: ret.id },
      data: {
        status: 'collected',
        collectedAt: now,
        collectedBy: input.collectedBy.trim(),
        handedOverById: input.actorUserId,
      },
    });
    const units = ret.lines.reduce((s, l) => s + l.pickedQty, 0);
    await postReturnFee(tx, { returnId: ret.id, actorUserId: input.actorUserId, now });
    await notifyMerchant(tx, ret.merchantId, 'return_collected', {
      returnId: ret.id,
      reference: ret.reference,
      units,
      collectedBy: input.collectedBy.trim(),
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'return.hand_over',
      entityType: 'merchant_return',
      entityId: ret.id,
      before: { status: 'ready' },
      after: { status: 'collected', collectedBy: input.collectedBy.trim(), units },
    });
    return { status: 'collected' as const, units };
  });
}

/**
 * Withdraws a return before staff start picking it. Reserved sellable units go back on sale.
 * A merchant may cancel only their own; admin any.
 */
export function cancelReturn(
  db: Db,
  input: { returnId: string; actorUserId: string; merchantId?: string; reason?: string },
) {
  return inTransaction(db, async (tx) => {
    const ret = await lockReturn(tx, input.returnId);
    if (input.merchantId && ret.merchantId !== input.merchantId)
      throw new DomainError('return_not_found', 404);
    if (ret.status !== 'requested') throw new DomainError('return_not_cancellable');
    for (const line of ret.lines.filter((l) => l.source === 'sellable')) {
      await release(tx, {
        darkStoreId: ret.darkStoreId,
        skuId: line.skuId,
        quantity: line.quantity,
        reason: `return_cancelled:${ret.id}`,
        actorUserId: input.actorUserId,
      });
    }
    await tx.merchantReturn.update({
      where: { id: ret.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: input.reason?.trim() || null,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'return.cancel',
      entityType: 'merchant_return',
      entityId: ret.id,
      before: { status: 'requested' },
      after: { status: 'cancelled', reason: input.reason ?? null },
    });
    return { status: 'cancelled' as const };
  });
}

export interface ReturnFilter {
  merchantId?: string;
  darkStoreId?: string;
  status?: ReturnStatus[];
}

export async function listReturns(db: Db, filter: ReturnFilter) {
  const rows = await db.merchantReturn.findMany({
    where: {
      merchantId: filter.merchantId,
      darkStoreId: filter.darkStoreId,
      status: filter.status ? { in: filter.status } : undefined,
    },
    include: {
      merchant: { select: { id: true, name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      lines: { select: { quantity: true, pickedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    merchant: r.merchant,
    darkStore: r.darkStore,
    units: r.lines.reduce((s, l) => s + l.quantity, 0),
    pickedUnits: r.lines.reduce((s, l) => s + l.pickedQty, 0),
    createdAt: r.createdAt.toISOString(),
    collectedAt: r.collectedAt?.toISOString() ?? null,
  }));
}

export async function getReturnDetail(db: Db, returnId: string) {
  const r = await db.merchantReturn.findUnique({
    where: { id: returnId },
    include: {
      merchant: { select: { id: true, name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      lines: {
        include: {
          sku: { select: { id: true, sku: true, barcode: true, titleEn: true, titleAr: true } },
        },
        orderBy: { id: 'asc' },
      },
      handedOverBy: { select: { name: true } },
    },
  });
  if (!r) return null;
  // Where each line's units are now, so staff know which shelf to walk to.
  const bins = await db.binStock.findMany({
    where: {
      skuId: { in: r.lines.map((l) => l.skuId) },
      quantity: { gt: 0 },
      bin: {
        darkStoreId: r.darkStoreId,
        isActive: true,
        type: { in: ['pickable', 'damaged', 'held'] },
      },
    },
    include: { bin: { select: { code: true, type: true } } },
    orderBy: { bin: { code: 'asc' } },
  });
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    note: r.note,
    merchant: r.merchant,
    darkStore: r.darkStore,
    createdAt: r.createdAt.toISOString(),
    readyAt: r.readyAt?.toISOString() ?? null,
    collectedAt: r.collectedAt?.toISOString() ?? null,
    collectedBy: r.collectedBy,
    handedOverBy: r.handedOverBy?.name ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    lines: r.lines.map((l) => ({
      skuId: l.skuId,
      sku: l.sku.sku,
      barcode: l.sku.barcode,
      titleEn: l.sku.titleEn,
      titleAr: l.sku.titleAr,
      source: l.source,
      quantity: l.quantity,
      pickedQty: l.pickedQty,
      bins: bins
        .filter((b) => b.skuId === l.skuId && b.bin.type === BIN_OF[l.source])
        .map((b) => ({ code: b.bin.code, quantity: b.quantity })),
    })),
  };
}

export type ReturnDetail = NonNullable<Awaited<ReturnType<typeof getReturnDetail>>>;
