import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { notifyMerchant } from './notifications';
import { adjust } from './stock';

export interface SubmitCountInput {
  darkStoreId: string;
  binId: string;
  /** Every product found in the bin. Products the bin should hold but are not listed count as 0. */
  lines: { skuId: string; countedQty: number }[];
  actorUserId: string;
}

/** Staff counted a bin. Stock does not change until an admin approves. */
export function submitCount(db: Db, input: SubmitCountInput) {
  return inTransaction(db, async (tx) => {
    const bin = await tx.bin.findUnique({ where: { id: input.binId } });
    if (!bin || bin.darkStoreId !== input.darkStoreId) throw new DomainError('bin_not_found', 404);
    const skuIds = input.lines.map((l) => l.skuId);
    if (new Set(skuIds).size !== skuIds.length) throw new DomainError('duplicate_sku', 400);
    if ((await tx.sku.count({ where: { id: { in: skuIds } } })) !== skuIds.length) {
      throw new DomainError('sku_not_found', 400);
    }

    const current = await tx.binStock.findMany({ where: { binId: bin.id } });
    const all = new Set([...current.filter((c) => c.quantity > 0).map((c) => c.skuId), ...skuIds]);
    const lines = [...all].map((skuId) => ({
      skuId,
      expectedQty: current.find((c) => c.skuId === skuId)?.quantity ?? 0,
      countedQty: input.lines.find((l) => l.skuId === skuId)?.countedQty ?? 0,
    }));

    const count = await tx.stockCount.create({
      data: {
        darkStoreId: bin.darkStoreId,
        binId: bin.id,
        submittedById: input.actorUserId,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'stock_count.submit',
      entityType: 'stock_count',
      entityId: count.id,
      after: { binId: bin.id, lines },
    });
    return {
      id: count.id,
      variances: lines.filter((l) => l.countedQty !== l.expectedQty).length,
      lines,
    };
  });
}

/**
 * Applies a submitted count. If the bin changed since the count, nothing is applied and
 * the count becomes stale so staff count again. Merchants whose products changed are notified.
 */
export async function approveCount(db: Db, input: { countId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const [locked] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM stock_counts WHERE id = ${input.countId} FOR UPDATE`;
    if (!locked) throw new DomainError('count_not_found', 404);
    if (locked.status !== 'submitted') throw new DomainError('count_already_reviewed');

    const count = await tx.stockCount.findUniqueOrThrow({
      where: { id: input.countId },
      include: { bin: true, darkStore: true, lines: { include: { sku: true } } },
    });
    const current = await tx.binStock.findMany({ where: { binId: count.binId } });
    const changed = count.lines.some(
      (l) => (current.find((c) => c.skuId === l.skuId)?.quantity ?? 0) !== l.expectedQty,
    );
    if (changed) {
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'stale', reviewedById: input.actorUserId, reviewedAt: new Date() },
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'stock_count.stale',
        entityType: 'stock_count',
        entityId: count.id,
        before: { status: 'submitted' },
        after: { status: 'stale' },
      });
      return { status: 'stale' as const, adjusted: 0 };
    }

    const differences = count.lines.filter((l) => l.countedQty !== l.expectedQty);
    for (const line of differences) {
      await adjust(tx, {
        skuId: line.skuId,
        binId: count.binId,
        delta: line.countedQty - line.expectedQty,
        reason: 'count',
        actorUserId: input.actorUserId,
        idempotencyKey: `count:${count.id}:${line.skuId}`,
      });
    }
    await tx.stockCount.update({
      where: { id: count.id },
      data: { status: 'approved', reviewedById: input.actorUserId, reviewedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'stock_count.approve',
      entityType: 'stock_count',
      entityId: count.id,
      before: { status: 'submitted' },
      after: { status: 'approved', adjusted: differences.length },
    });

    const byMerchant = new Map<string, typeof differences>();
    for (const line of differences) {
      byMerchant.set(line.sku.merchantId, [...(byMerchant.get(line.sku.merchantId) ?? []), line]);
    }
    for (const [merchantId, lines] of byMerchant) {
      await notifyMerchant(tx, merchantId, 'stock_count_adjusted', {
        countId: count.id,
        darkStore: {
          code: count.darkStore.code,
          nameEn: count.darkStore.nameEn,
          nameAr: count.darkStore.nameAr,
        },
        bin: count.bin.code,
        lines: lines.map((l) => ({
          sku: l.sku.sku,
          titleEn: l.sku.titleEn,
          titleAr: l.sku.titleAr,
          before: l.expectedQty,
          after: l.countedQty,
        })),
      });
    }
    return { status: 'approved' as const, adjusted: differences.length };
  });
}

export function rejectCount(
  db: Db,
  input: { countId: string; actorUserId: string; note?: string },
) {
  return inTransaction(db, async (tx) => {
    const updated = await tx.stockCount.updateMany({
      where: { id: input.countId, status: 'submitted' },
      data: {
        status: 'rejected',
        reviewedById: input.actorUserId,
        reviewedAt: new Date(),
        reviewNote: input.note,
      },
    });
    if (updated.count !== 1) throw new DomainError('count_already_reviewed');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'stock_count.reject',
      entityType: 'stock_count',
      entityId: input.countId,
      before: { status: 'submitted' },
      after: { status: 'rejected', note: input.note ?? null },
    });
  });
}
