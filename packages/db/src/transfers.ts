import type { Prisma, TransferOrigin, TransferStatus } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { dispatch, receive, release, reserve, StockError } from './stock';

// Transfers move stock between locations, one leg at a time.
//
//   draft ──approve──▶ approved ──first scan──▶ picking ──send──▶ in_transit ──close──▶ received
//     └──────────────────┴──cancel (nothing picked yet)──▶ cancelled
//
// Approval reserves the units at the sender, so a store stops selling them. Store to store
// always goes through the hub (cuts trips): the first leg goes to the hub and carries the final
// destination; when the hub closes its receipt the onward leg is created, or the units join the
// hub's open trip to that store, and the hub picks them straight from its receiving bin.

type Tx = Prisma.TransactionClient;

const OPEN: TransferStatus[] = ['draft', 'approved', 'picking'];

export interface TransferLineInput {
  skuId: string;
  quantity: number;
}

export interface CreateTransferInput {
  fromId: string;
  toId: string;
  lines: TransferLineInput[];
  note?: string;
  origin?: TransferOrigin;
  /** Refill drafts wait for admin; transfers admin creates by hand are approved at once */
  draft?: boolean;
  refillDay?: string;
  actorUserId: string | null;
}

async function nextReference(tx: Tx) {
  // Numbered one at a time: TRF-1001, TRF-1002, ...
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('transfer_reference'))`;
  const count = await tx.transfer.count();
  return `TRF-${1001 + count}`;
}

async function lockTransfer(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM transfers WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError('transfer_not_found', 404);
  return tx.transfer.findUniqueOrThrow({
    where: { id },
    include: { lines: true, from: true, to: true },
  });
}

/** Holds the units at the sender. Units on hub shelves are held too (only transfers use them). */
async function reserveLines(
  tx: Tx,
  transfer: { id: string; fromId: string; reference: string },
  lines: TransferLineInput[],
  actorUserId: string | null,
) {
  for (const line of lines) {
    try {
      await reserve(tx, {
        darkStoreId: transfer.fromId,
        skuId: line.skuId,
        quantity: line.quantity,
        reason: `transfer:${transfer.reference}`,
        actorUserId,
      });
    } catch (error) {
      if (error instanceof StockError) throw new DomainError('not_enough_available');
      throw error;
    }
  }
}

/**
 * Creates one leg. Store to store becomes store to hub, carrying the final destination,
 * whenever a hub exists.
 */
export function createTransfer(db: Db, input: CreateTransferInput) {
  return inTransaction(db, async (tx) => {
    if (input.fromId === input.toId) throw new DomainError('same_location', 400);
    if (input.lines.length === 0) throw new DomainError('no_lines', 400);
    const skuIds = input.lines.map((l) => l.skuId);
    if (new Set(skuIds).size !== skuIds.length) throw new DomainError('duplicate_sku', 400);
    const [from, to] = await Promise.all([
      tx.darkStore.findUnique({ where: { id: input.fromId } }),
      tx.darkStore.findUnique({ where: { id: input.toId } }),
    ]);
    if (!from?.isActive || !to?.isActive) throw new DomainError('dark_store_not_found', 404);
    if ((await tx.sku.count({ where: { id: { in: skuIds } } })) !== skuIds.length)
      throw new DomainError('sku_not_found', 400);

    let toId = to.id;
    let finalDestinationId: string | null = null;
    if (from.kind === 'dark_store' && to.kind === 'dark_store') {
      const hub = await tx.darkStore.findFirst({
        where: { kind: 'hub', isActive: true },
        orderBy: { code: 'asc' },
      });
      if (hub) {
        toId = hub.id;
        finalDestinationId = to.id;
      }
    }

    const draft = input.draft ?? false;
    const now = new Date();
    const transfer = await tx.transfer.create({
      data: {
        reference: await nextReference(tx),
        fromId: from.id,
        toId,
        finalDestinationId,
        status: draft ? 'draft' : 'approved',
        origin: input.origin ?? 'manual',
        refillDay: input.refillDay,
        note: input.note?.trim() || null,
        createdById: input.actorUserId,
        approvedById: draft ? null : input.actorUserId,
        approvedAt: draft ? null : now,
        lines: { create: input.lines },
      },
    });
    if (!draft) await reserveLines(tx, transfer, input.lines, input.actorUserId);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'transfer.create',
      entityType: 'transfer',
      entityId: transfer.id,
      after: {
        reference: transfer.reference,
        from: from.code,
        to: toId,
        finalDestinationId,
        status: transfer.status,
        lines: input.lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
      },
    });
    return transfer;
  });
}

/** Admin approves a refill draft, optionally changing quantities (0 drops a line). */
export function approveTransfer(
  db: Db,
  input: { transferId: string; lines?: TransferLineInput[]; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const t = await lockTransfer(tx, input.transferId);
    if (t.status !== 'draft') throw new DomainError('invalid_transfer_state');
    if (input.lines) {
      for (const line of t.lines) {
        const change = input.lines.find((l) => l.skuId === line.skuId);
        if (!change) continue;
        if (change.quantity <= 0) await tx.transferLine.delete({ where: { id: line.id } });
        else
          await tx.transferLine.update({
            where: { id: line.id },
            data: { quantity: change.quantity },
          });
      }
    }
    const lines = await tx.transferLine.findMany({ where: { transferId: t.id } });
    if (lines.length === 0) throw new DomainError('no_lines', 400);
    await reserveLines(tx, t, lines, input.actorUserId);
    await tx.transfer.update({
      where: { id: t.id },
      data: { status: 'approved', approvedById: input.actorUserId, approvedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'transfer.approve',
      entityType: 'transfer',
      entityId: t.id,
      before: {
        status: 'draft',
        lines: t.lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
      },
      after: {
        status: 'approved',
        lines: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity })),
      },
    });
    return { status: 'approved' as const };
  });
}

/** Cancels a transfer nothing was picked from yet. Held units go back on sale. */
export function cancelTransfer(
  db: Db,
  input: { transferId: string; reason?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const t = await lockTransfer(tx, input.transferId);
    if (t.status !== 'draft' && t.status !== 'approved')
      throw new DomainError('transfer_not_cancellable');
    if (t.status === 'approved' && !t.previousId) {
      for (const line of t.lines)
        await release(tx, {
          darkStoreId: t.fromId,
          skuId: line.skuId,
          quantity: line.quantity,
          reason: `transfer_cancelled:${t.reference}`,
          actorUserId: input.actorUserId,
        });
    }
    await tx.transfer.update({
      where: { id: t.id },
      data: { status: 'cancelled', cancelledAt: new Date(), note: input.reason?.trim() || t.note },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'transfer.cancel',
      entityType: 'transfer',
      entityId: t.id,
      before: { status: t.status },
      after: { status: 'cancelled', reason: input.reason ?? null },
    });
    return { status: 'cancelled' as const };
  });
}

export interface PickTransferInput {
  transferId: string;
  darkStoreId: string;
  skuId: string;
  binId?: string;
  quantity: number;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * Sender staff scan units onto the truck. A leg that leaves the hub for a store (onward leg)
 * takes units from the hub's receiving bin first, then its shelves; any other leg takes held
 * units from shelves.
 */
export function pickForTransfer(db: Db, input: PickTransferInput) {
  return inTransaction(db, async (tx) => {
    const key = `transfer-pick:${input.idempotencyKey}`;
    const seen = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
    const t = await lockTransfer(tx, input.transferId);
    if (t.fromId !== input.darkStoreId) throw new DomainError('transfer_not_found', 404);
    if (seen) return { status: t.status, replayed: true };
    if (t.status !== 'approved' && t.status !== 'picking')
      throw new DomainError('invalid_transfer_state');
    const line = t.lines.find((l) => l.skuId === input.skuId);
    if (!line) throw new DomainError('sku_not_on_transfer');
    if (line.pickedQty + input.quantity > line.quantity) throw new DomainError('over_pick');

    // Onward legs from the hub hold nothing: their units sit in receiving or on hub shelves.
    const onward = Boolean(t.previousId);
    const allowed = onward ? ['receiving', 'pickable'] : ['pickable'];
    let bin = input.binId ? await tx.bin.findUnique({ where: { id: input.binId } }) : null;
    if (input.binId && (!bin || bin.darkStoreId !== t.fromId))
      throw new DomainError('bin_not_found', 404);
    if (bin && !allowed.includes(bin.type)) throw new DomainError('bin_not_allowed', 400);
    if (!bin) {
      const candidates = await tx.bin.findMany({
        where: {
          darkStoreId: t.fromId,
          isActive: true,
          type: { in: allowed as ('receiving' | 'pickable')[] },
          stock: { some: { skuId: input.skuId, quantity: { gte: input.quantity } } },
        },
        orderBy: { code: 'asc' },
      });
      // Receiving first for onward legs (cross dock), then shelves in code order.
      bin = candidates.find((b) => b.type === 'receiving') ?? candidates[0] ?? null;
    }
    if (!bin) throw new DomainError('not_on_shelf');
    try {
      await dispatch(tx, {
        binId: bin.id,
        skuId: input.skuId,
        quantity: input.quantity,
        transferId: t.id,
        reserved: !onward,
        reason: `transfer:${t.reference}`,
        actorUserId: input.actorUserId,
        idempotencyKey: key,
      });
    } catch (error) {
      if (error instanceof StockError && error.code === 'insufficient_bin_stock')
        throw new DomainError('not_on_shelf');
      throw error;
    }
    await tx.transferLine.update({
      where: { id: line.id },
      data: { pickedQty: { increment: input.quantity } },
    });
    if (t.status === 'approved')
      await tx.transfer.update({ where: { id: t.id }, data: { status: 'picking' } });
    return { status: 'picking' as const, bin: bin.code, replayed: false };
  });
}

/** The truck leaves. Units that could not be found are released at the sender and recorded. */
export function sendTransfer(
  db: Db,
  input: { transferId: string; darkStoreId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const t = await lockTransfer(tx, input.transferId);
    if (t.fromId !== input.darkStoreId) throw new DomainError('transfer_not_found', 404);
    if (t.status !== 'picking') throw new DomainError('invalid_transfer_state');
    const onward = Boolean(t.previousId);
    const short = t.lines.filter((l) => l.pickedQty < l.quantity);
    if (!onward) {
      for (const line of short)
        await release(tx, {
          darkStoreId: t.fromId,
          skuId: line.skuId,
          quantity: line.quantity - line.pickedQty,
          reason: `transfer_short:${t.reference}`,
          actorUserId: input.actorUserId,
        });
    }
    if (short.length > 0) {
      await tx.alert.create({
        data: {
          type: 'transfer_short_sent',
          darkStoreId: t.fromId,
          data: {
            transferId: t.id,
            reference: t.reference,
            lines: short.map((l) => ({ skuId: l.skuId, missing: l.quantity - l.pickedQty })),
          },
        },
      });
    }
    await tx.transfer.update({
      where: { id: t.id },
      data: { status: 'in_transit', sentAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'transfer.send',
      entityType: 'transfer',
      entityId: t.id,
      before: { status: 'picking' },
      after: {
        status: 'in_transit',
        units: t.lines.reduce((s, l) => s + l.pickedQty, 0),
        short: short.map((l) => ({ skuId: l.skuId, missing: l.quantity - l.pickedQty })),
      },
    });
    return { status: 'in_transit' as const };
  });
}

export interface ReceiveTransferInput {
  transferId: string;
  darkStoreId: string;
  skuId: string;
  quantity: number;
  actorUserId: string;
  idempotencyKey: string;
}

/** Receiver staff scan units off the truck into the receiving bin, then put them away. */
export function receiveTransfer(db: Db, input: ReceiveTransferInput) {
  return inTransaction(db, async (tx) => {
    const key = `transfer-receive:${input.idempotencyKey}`;
    const seen = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
    const t = await lockTransfer(tx, input.transferId);
    if (t.toId !== input.darkStoreId) throw new DomainError('transfer_not_found', 404);
    if (seen) return { replayed: true };
    if (t.status !== 'in_transit') throw new DomainError('invalid_transfer_state');
    const line = t.lines.find((l) => l.skuId === input.skuId);
    if (!line) throw new DomainError('sku_not_on_transfer');
    if (line.receivedQty + input.quantity > line.pickedQty) throw new DomainError('over_receive');
    const receiving = await tx.bin.findFirst({
      where: { darkStoreId: t.toId, type: 'receiving', isActive: true },
      orderBy: { code: 'asc' },
    });
    if (!receiving) throw new DomainError('no_receiving_bin');
    await receive(tx, {
      binId: receiving.id,
      skuId: input.skuId,
      quantity: input.quantity,
      transferId: t.id,
      reason: `transfer:${t.reference}`,
      actorUserId: input.actorUserId,
      idempotencyKey: key,
    });
    await tx.transferLine.update({
      where: { id: line.id },
      data: { receivedQty: { increment: input.quantity } },
    });
    return { replayed: false, bin: receiving.code };
  });
}

/**
 * Receiver closes the receipt. Shortfalls raise an alert. At the hub, units bound for a store
 * go on the onward leg: the open trip to that store if there is one, otherwise a new leg.
 */
export function closeTransfer(
  db: Db,
  input: { transferId: string; darkStoreId: string; actorUserId: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const t = await lockTransfer(tx, input.transferId);
    if (t.toId !== input.darkStoreId) throw new DomainError('transfer_not_found', 404);
    if (t.status !== 'in_transit') throw new DomainError('invalid_transfer_state');
    const missing = t.lines.filter((l) => l.receivedQty < l.pickedQty);
    if (missing.length > 0) {
      await tx.alert.create({
        data: {
          type: 'transfer_short_received',
          darkStoreId: t.toId,
          data: {
            transferId: t.id,
            reference: t.reference,
            lines: missing.map((l) => ({ skuId: l.skuId, missing: l.pickedQty - l.receivedQty })),
          },
        },
      });
    }
    await tx.transfer.update({
      where: { id: t.id },
      data: { status: 'received', receivedAt: now },
    });

    let onwardId: string | null = null;
    const units = t.lines.filter((l) => l.receivedQty > 0);
    if (t.finalDestinationId && units.length > 0) {
      // One trip per store: join the hub's open onward trip to the same store if not yet picked.
      const open = await tx.transfer.findFirst({
        where: {
          fromId: t.toId,
          toId: t.finalDestinationId,
          status: 'approved',
          previousId: { not: null },
        },
        include: { lines: true },
        orderBy: { createdAt: 'asc' },
      });
      if (open) {
        for (const l of units) {
          const same = open.lines.find((x) => x.skuId === l.skuId);
          if (same)
            await tx.transferLine.update({
              where: { id: same.id },
              data: { quantity: { increment: l.receivedQty } },
            });
          else
            await tx.transferLine.create({
              data: { transferId: open.id, skuId: l.skuId, quantity: l.receivedQty },
            });
        }
        onwardId = open.id;
      } else {
        const onward = await tx.transfer.create({
          data: {
            reference: await nextReference(tx),
            fromId: t.toId,
            toId: t.finalDestinationId,
            previousId: t.id,
            status: 'approved',
            origin: t.origin,
            refillDay: t.refillDay,
            approvedAt: now,
            lines: { create: units.map((l) => ({ skuId: l.skuId, quantity: l.receivedQty })) },
          },
        });
        onwardId = onward.id;
      }
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'transfer.receive',
      entityType: 'transfer',
      entityId: t.id,
      before: { status: 'in_transit' },
      after: {
        status: 'received',
        received: t.lines.map((l) => ({
          skuId: l.skuId,
          sent: l.pickedQty,
          received: l.receivedQty,
        })),
        onwardId,
      },
    });
    return { status: 'received' as const, onwardId, short: missing.length > 0 };
  });
}

// ─── views ─────────────────────────────────────────────────────────────────────

const storeRef = { select: { id: true, kind: true, code: true, nameEn: true, nameAr: true } };

export async function listTransfers(
  db: Db,
  filter: { status?: TransferStatus[]; fromId?: string; toId?: string; locationId?: string },
) {
  const rows = await db.transfer.findMany({
    where: {
      status: filter.status ? { in: filter.status } : undefined,
      fromId: filter.fromId,
      toId: filter.toId,
      ...(filter.locationId && {
        OR: [{ fromId: filter.locationId }, { toId: filter.locationId }],
      }),
    },
    include: {
      from: storeRef,
      to: storeRef,
      finalDestination: storeRef,
      lines: { select: { quantity: true, pickedQty: true, receivedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return rows.map((t) => ({
    id: t.id,
    reference: t.reference,
    status: t.status,
    origin: t.origin,
    from: t.from,
    to: t.to,
    finalDestination: t.finalDestination,
    onward: Boolean(t.previousId),
    units: t.lines.reduce((s, l) => s + l.quantity, 0),
    pickedUnits: t.lines.reduce((s, l) => s + l.pickedQty, 0),
    receivedUnits: t.lines.reduce((s, l) => s + l.receivedQty, 0),
    createdAt: t.createdAt.toISOString(),
    sentAt: t.sentAt?.toISOString() ?? null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
  }));
}

export async function getTransferDetail(db: Db, id: string) {
  const t = await db.transfer.findUnique({
    where: { id },
    include: {
      from: storeRef,
      to: storeRef,
      finalDestination: storeRef,
      previous: { select: { id: true, reference: true } },
      next: { select: { id: true, reference: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lines: {
        include: {
          sku: {
            select: {
              sku: true,
              barcode: true,
              titleEn: true,
              titleAr: true,
              merchant: { select: { name: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      },
    },
  });
  if (!t) return null;
  const bins = await db.binStock.findMany({
    where: {
      skuId: { in: t.lines.map((l) => l.skuId) },
      quantity: { gt: 0 },
      bin: { darkStoreId: t.fromId, isActive: true, type: { in: ['pickable', 'receiving'] } },
    },
    include: { bin: { select: { code: true, type: true } } },
    orderBy: { bin: { code: 'asc' } },
  });
  return {
    id: t.id,
    reference: t.reference,
    status: t.status,
    origin: t.origin,
    note: t.note,
    from: t.from,
    to: t.to,
    finalDestination: t.finalDestination,
    previous: t.previous,
    next: t.next,
    createdBy: t.createdBy?.name ?? null,
    approvedBy: t.approvedBy?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    approvedAt: t.approvedAt?.toISOString() ?? null,
    sentAt: t.sentAt?.toISOString() ?? null,
    receivedAt: t.receivedAt?.toISOString() ?? null,
    lines: t.lines.map((l) => ({
      skuId: l.skuId,
      sku: l.sku.sku,
      barcode: l.sku.barcode,
      titleEn: l.sku.titleEn,
      titleAr: l.sku.titleAr,
      merchant: l.sku.merchant.name,
      quantity: l.quantity,
      pickedQty: l.pickedQty,
      receivedQty: l.receivedQty,
      bins: bins
        .filter((b) => b.skuId === l.skuId)
        .map((b) => ({ code: b.bin.code, type: b.bin.type, quantity: b.quantity })),
    })),
  };
}

export type TransferDetail = NonNullable<Awaited<ReturnType<typeof getTransferDetail>>>;

/** Open transfers count for one location's staff home: to pick and to receive. */
export async function transferCounts(db: Db, darkStoreId: string) {
  const [toPick, toReceive] = await Promise.all([
    db.transfer.count({ where: { fromId: darkStoreId, status: { in: ['approved', 'picking'] } } }),
    db.transfer.count({ where: { toId: darkStoreId, status: 'in_transit' } }),
  ]);
  return { toPick, toReceive };
}

export { OPEN as OPEN_TRANSFER_STATUSES };
