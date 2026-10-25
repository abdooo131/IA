import type { Prisma } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { notifyMerchant } from './notifications';
import { receive } from './stock';

export interface CreateManifestInput {
  merchantId: string;
  darkStoreId: string;
  reference: string;
  note?: string;
  expectedAt?: Date;
  lines: { skuId: string; expectedQty: number }[];
  actorUserId: string;
}

/** A merchant announces a shipment to a dark store. */
export function createManifest(db: Db, input: CreateManifestInput) {
  return inTransaction(db, async (tx) => {
    const store = await tx.darkStore.findUnique({ where: { id: input.darkStoreId } });
    if (!store || !store.isActive) throw new DomainError('dark_store_not_found', 404);
    const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
    if (skuIds.length !== input.lines.length) throw new DomainError('duplicate_sku', 400);
    const owned = await tx.sku.count({
      where: { id: { in: skuIds }, merchantId: input.merchantId },
    });
    if (owned !== skuIds.length) throw new DomainError('sku_not_found', 400);
    const taken = await tx.inboundManifest.findUnique({
      where: { merchantId_reference: { merchantId: input.merchantId, reference: input.reference } },
    });
    if (taken) throw new DomainError('reference_taken');

    const manifest = await tx.inboundManifest.create({
      data: {
        merchantId: input.merchantId,
        darkStoreId: input.darkStoreId,
        reference: input.reference,
        note: input.note,
        expectedAt: input.expectedAt,
        createdById: input.actorUserId,
        lines: { create: input.lines.map((l) => ({ skuId: l.skuId, expectedQty: l.expectedQty })) },
      },
      include: { lines: true },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'manifest.create',
      entityType: 'inbound_manifest',
      entityId: manifest.id,
      after: {
        reference: manifest.reference,
        darkStoreId: manifest.darkStoreId,
        lines: input.lines,
      },
    });
    return manifest;
  });
}

/** The merchant withdraws a shipment that has not started arriving. */
export function cancelManifest(
  db: Db,
  input: { manifestId: string; merchantId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const updated = await tx.inboundManifest.updateMany({
      where: { id: input.manifestId, merchantId: input.merchantId, status: 'expected' },
      data: { status: 'cancelled' },
    });
    if (updated.count !== 1) throw new DomainError('manifest_not_cancellable');
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'manifest.cancel',
      entityType: 'inbound_manifest',
      entityId: input.manifestId,
      before: { status: 'expected' },
      after: { status: 'cancelled' },
    });
  });
}

export interface ReceiveOnManifestInput {
  manifestId: string;
  darkStoreId: string;
  skuId: string;
  quantity: number;
  actorUserId: string;
  /** One per scan, so a double tap or a retried request counts once */
  idempotencyKey: string;
}

/**
 * Staff scanned units of a shipment. They go into the store's receiving bin and count
 * against the manifest line; a product that was not on the manifest gets a line with
 * expected 0, so extras are visible.
 */
export function receiveOnManifest(db: Db, input: ReceiveOnManifestInput) {
  return inTransaction(db, async (tx) => {
    const manifest = await tx.inboundManifest.findUnique({ where: { id: input.manifestId } });
    if (!manifest || manifest.darkStoreId !== input.darkStoreId)
      throw new DomainError('manifest_not_found', 404);
    if (manifest.status !== 'expected' && manifest.status !== 'receiving') {
      throw new DomainError('manifest_closed');
    }
    const sku = await tx.sku.findUnique({ where: { id: input.skuId } });
    if (!sku || sku.merchantId !== manifest.merchantId)
      throw new DomainError('sku_not_on_merchant', 400);
    const bin = await receivingBin(tx, manifest.darkStoreId);

    const result = await receive(tx, {
      skuId: sku.id,
      binId: bin.id,
      quantity: input.quantity,
      manifestId: manifest.id,
      actorUserId: input.actorUserId,
      reason: 'inbound',
      idempotencyKey: input.idempotencyKey,
    });
    if (!result.replayed) {
      await tx.inboundManifestLine.upsert({
        where: { manifestId_skuId: { manifestId: manifest.id, skuId: sku.id } },
        create: {
          manifestId: manifest.id,
          skuId: sku.id,
          expectedQty: 0,
          receivedQty: input.quantity,
        },
        update: { receivedQty: { increment: input.quantity } },
      });
      if (manifest.status === 'expected') {
        await tx.inboundManifest.update({
          where: { id: manifest.id },
          data: { status: 'receiving' },
        });
      }
    }
    return { replayed: result.replayed, binCode: bin.code };
  });
}

/** Staff finish receiving. The merchant is told what arrived, what is missing and what was extra. */
export function closeManifest(
  db: Db,
  input: { manifestId: string; darkStoreId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const manifest = await tx.inboundManifest.findUnique({
      where: { id: input.manifestId },
      include: { lines: { include: { sku: true } }, darkStore: true },
    });
    if (!manifest || manifest.darkStoreId !== input.darkStoreId)
      throw new DomainError('manifest_not_found', 404);
    if (manifest.status !== 'expected' && manifest.status !== 'receiving') {
      throw new DomainError('manifest_closed');
    }
    await tx.inboundManifest.update({
      where: { id: manifest.id },
      data: { status: 'received', receivedAt: new Date() },
    });
    const lines = manifest.lines.map((l) => ({
      sku: l.sku.sku,
      titleEn: l.sku.titleEn,
      titleAr: l.sku.titleAr,
      expectedQty: l.expectedQty,
      receivedQty: l.receivedQty,
    }));
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'manifest.close',
      entityType: 'inbound_manifest',
      entityId: manifest.id,
      before: { status: manifest.status },
      after: { status: 'received', lines },
    });
    await notifyMerchant(tx, manifest.merchantId, 'manifest_received', {
      manifestId: manifest.id,
      reference: manifest.reference,
      darkStore: {
        code: manifest.darkStore.code,
        nameEn: manifest.darkStore.nameEn,
        nameAr: manifest.darkStore.nameAr,
      },
      lines,
    });
    return { lines };
  });
}

async function receivingBin(tx: Prisma.TransactionClient, darkStoreId: string) {
  const bin = await tx.bin.findFirst({
    where: { darkStoreId, type: 'receiving', isActive: true },
    orderBy: { code: 'asc' },
  });
  if (!bin) throw new DomainError('no_receiving_bin');
  return bin;
}

export interface ManifestDetail {
  id: string;
  reference: string;
  status: string;
  note: string | null;
  expectedAt: Date | null;
  createdAt: Date;
  receivedAt: Date | null;
  merchant: { id: string; name: string };
  darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  createdBy: { name: string; email: string } | null;
  timeline: { at: Date; event: string; by: string | null }[];
  lines: {
    skuId: string;
    sku: string;
    barcode: string | null;
    titleEn: string;
    titleAr: string;
    expectedQty: number;
    receivedQty: number;
  }[];
  scans: {
    at: Date;
    by: string | null;
    sku: string;
    titleEn: string;
    titleAr: string;
    quantity: number;
    bin: string;
  }[];
}

const TIMELINE_EVENTS: Record<string, string> = {
  'manifest.create': 'created',
  'manifest.cancel': 'cancelled',
  'manifest.close': 'received',
};

/** Everything about one shipment: who did what and when, the goods, and every scan. */
export async function getManifestDetail(
  db: Db,
  manifestId: string,
): Promise<ManifestDetail | null> {
  const m = await db.inboundManifest.findUnique({
    where: { id: manifestId },
    include: {
      merchant: true,
      darkStore: true,
      createdBy: true,
      lines: { include: { sku: true }, orderBy: { sku: { sku: 'asc' } } },
      stockMovements: {
        where: { type: 'receive' },
        include: { actor: true, sku: true, toBin: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!m) return null;

  const audits = await db.auditLog.findMany({
    where: { entityType: 'inbound_manifest', entityId: m.id },
    include: { actor: true },
    orderBy: { createdAt: 'asc' },
  });
  const timeline = audits
    .filter((a) => TIMELINE_EVENTS[a.action])
    .map((a) => ({
      at: a.createdAt,
      event: TIMELINE_EVENTS[a.action]!,
      by: a.actor?.name ?? null,
    }));
  const firstScan = m.stockMovements[0];
  if (firstScan) {
    timeline.push({
      at: firstScan.createdAt,
      event: 'receiving_started',
      by: firstScan.actor?.name ?? null,
    });
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    id: m.id,
    reference: m.reference,
    status: m.status,
    note: m.note,
    expectedAt: m.expectedAt,
    createdAt: m.createdAt,
    receivedAt: m.receivedAt,
    merchant: { id: m.merchant.id, name: m.merchant.name },
    darkStore: {
      id: m.darkStore.id,
      code: m.darkStore.code,
      nameEn: m.darkStore.nameEn,
      nameAr: m.darkStore.nameAr,
    },
    createdBy: m.createdBy ? { name: m.createdBy.name, email: m.createdBy.email } : null,
    timeline,
    lines: m.lines.map((l) => ({
      skuId: l.skuId,
      sku: l.sku.sku,
      barcode: l.sku.barcode,
      titleEn: l.sku.titleEn,
      titleAr: l.sku.titleAr,
      expectedQty: l.expectedQty,
      receivedQty: l.receivedQty,
    })),
    scans: m.stockMovements.map((s) => ({
      at: s.createdAt,
      by: s.actor?.name ?? null,
      sku: s.sku.sku,
      titleEn: s.sku.titleEn,
      titleAr: s.sku.titleAr,
      quantity: s.quantity,
      bin: s.toBin?.code ?? '',
    })),
  };
}
