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
