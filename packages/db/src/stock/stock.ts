import { type Bin, type MovementType, Prisma, type StockMovement } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { StockError } from './errors';

// Every function here follows CLAUDE.md rules 2 to 5 and 8:
//  1. one transaction per call (or the caller's transaction, see inTransaction)
//  2. the stock_movements row is inserted first, so a repeated idempotency key stops
//     before any stock changes
//  3. bin_stock and stock_levels change with guarded UPDATEs, so concurrent calls cannot
//     push a number below zero; CHECK constraints in the database are the last line
//  4. an audit_log row records the state before and after

type Tx = Prisma.TransactionClient;

export interface Level {
  onHand: number;
  reserved: number;
}

export interface StockResult {
  movement: StockMovement;
  /** The store level after the change, or null when it did not change */
  level: Level | null;
  /** True when the idempotency key was already used and nothing was changed */
  replayed: boolean;
}

interface Common {
  skuId: string;
  quantity: number;
  actorUserId?: string | null;
  idempotencyKey?: string;
  reason?: string;
}

export interface ReceiveInput extends Common {
  binId: string;
  manifestId?: string;
}
export interface MoveInput extends Common {
  fromBinId: string;
  toBinId: string;
}
export interface ReserveInput extends Common {
  darkStoreId: string;
  orderId?: string;
}
export interface PickInput extends Common {
  binId: string;
  orderId?: string;
}
export interface DispatchInput extends Common {
  binId: string;
  returnId?: string;
}
export interface AdjustInput extends Omit<Common, 'quantity'> {
  binId: string;
  /** Positive to add units, negative to remove them */
  delta: number;
  reason: string;
}

/** Units into a bin from outside the store (inbound manifest, opening stock). */
export async function receive(db: Db, input: ReceiveInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  return run(db, input, async (tx) => {
    const bin = await loadBin(tx, input.binId);
    const movement = await insertMovement(tx, input, {
      type: 'receive',
      darkStoreId: bin.darkStoreId,
      toBinId: bin.id,
      manifestId: input.manifestId,
    });
    const binAfter = await addToBin(tx, bin.id, input.skuId, input.quantity);
    const level =
      bin.type === 'pickable'
        ? await changeLevel(
            tx,
            bin.darkStoreId,
            input.skuId,
            input.quantity,
            0,
            'insufficient_stock',
          )
        : null;
    await audit(tx, movement, level, input.quantity, 0, { [bin.code]: binAfter });
    return { movement, level };
  });
}

/** Units from one bin to another in the same store: put away, damage, hold, release. */
export async function move(db: Db, input: MoveInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  if (input.fromBinId === input.toBinId) throw new StockError('same_bin');
  return run(db, input, async (tx) => {
    const [from, to] = await Promise.all([
      loadBin(tx, input.fromBinId),
      loadBin(tx, input.toBinId),
    ]);
    if (from.darkStoreId !== to.darkStoreId) throw new StockError('bin_wrong_store');

    const movement = await insertMovement(tx, input, {
      type: 'move',
      darkStoreId: from.darkStoreId,
      fromBinId: from.id,
      toBinId: to.id,
    });

    // Lock bin rows in a fixed order so two opposite moves cannot deadlock.
    let fromAfter = 0;
    let toAfter = 0;
    if (from.id < to.id) {
      fromAfter = await takeFromBin(tx, from.id, input.skuId, input.quantity);
      toAfter = await addToBin(tx, to.id, input.skuId, input.quantity);
    } else {
      toAfter = await addToBin(tx, to.id, input.skuId, input.quantity);
      fromAfter = await takeFromBin(tx, from.id, input.skuId, input.quantity);
    }

    // Only crossing the pickable boundary changes what the store can sell.
    const delta =
      (to.type === 'pickable' ? input.quantity : 0) -
      (from.type === 'pickable' ? input.quantity : 0);
    const level =
      delta === 0
        ? null
        : await changeLevel(
            tx,
            from.darkStoreId,
            input.skuId,
            delta,
            0,
            'would_break_reservations',
          );
    await audit(tx, movement, level, delta, 0, { [from.code]: fromAfter, [to.code]: toAfter });
    return { movement, level };
  });
}

/** Holds units for an order. Fails if fewer than `quantity` units are available. */
export async function reserve(db: Db, input: ReserveInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  return run(db, input, async (tx) => {
    const movement = await insertMovement(tx, input, {
      type: 'reserve',
      darkStoreId: input.darkStoreId,
      orderId: input.orderId,
    });
    const level = await changeLevel(
      tx,
      input.darkStoreId,
      input.skuId,
      0,
      input.quantity,
      'insufficient_stock',
    );
    await audit(tx, movement, level, 0, input.quantity);
    return { movement, level };
  });
}

/** Gives back units reserved for an order, for example when it is cancelled. */
export async function release(db: Db, input: ReserveInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  return run(db, input, async (tx) => {
    const movement = await insertMovement(tx, input, {
      type: 'release',
      darkStoreId: input.darkStoreId,
      orderId: input.orderId,
    });
    const level = await changeLevel(
      tx,
      input.darkStoreId,
      input.skuId,
      0,
      -input.quantity,
      'insufficient_reserved',
    );
    await audit(tx, movement, level, 0, -input.quantity);
    return { movement, level };
  });
}

/** Takes reserved units off a pickable shelf for an order. */
export async function pick(db: Db, input: PickInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  return run(db, input, async (tx) => {
    const bin = await loadBin(tx, input.binId);
    if (bin.type !== 'pickable') throw new StockError('bin_not_pickable');
    const movement = await insertMovement(tx, input, {
      type: 'pick',
      darkStoreId: bin.darkStoreId,
      fromBinId: bin.id,
      orderId: input.orderId,
    });
    const binAfter = await takeFromBin(tx, bin.id, input.skuId, input.quantity);
    const level = await changeLevel(
      tx,
      bin.darkStoreId,
      input.skuId,
      -input.quantity,
      -input.quantity,
      'insufficient_reserved',
    );
    await audit(tx, movement, level, -input.quantity, -input.quantity, { [bin.code]: binAfter });
    return { movement, level };
  });
}

/**
 * Units leave the store for good (back to the merchant). From a pickable shelf they must
 * have been reserved first, so the units come off on_hand and reserved together; from a
 * damaged or held bin only the bin changes.
 */
export async function dispatch(db: Db, input: DispatchInput): Promise<StockResult> {
  assertQuantity(input.quantity);
  return run(db, input, async (tx) => {
    const bin = await loadBin(tx, input.binId);
    if (bin.type === 'receiving') throw new StockError('bin_not_allowed');
    const movement = await insertMovement(tx, input, {
      type: 'dispatch',
      darkStoreId: bin.darkStoreId,
      fromBinId: bin.id,
      returnId: input.returnId,
    });
    const binAfter = await takeFromBin(tx, bin.id, input.skuId, input.quantity);
    const level =
      bin.type === 'pickable'
        ? await changeLevel(
            tx,
            bin.darkStoreId,
            input.skuId,
            -input.quantity,
            -input.quantity,
            'insufficient_reserved',
          )
        : null;
    const sellable = bin.type === 'pickable' ? -input.quantity : 0;
    await audit(tx, movement, level, sellable, sellable, { [bin.code]: binAfter });
    return { movement, level };
  });
}

/** Corrects a bin after a count or a mistake. Cannot remove units that orders reserved. */
export async function adjust(db: Db, input: AdjustInput): Promise<StockResult> {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new StockError('invalid_quantity');
  const quantity = Math.abs(input.delta);
  return run(db, input, async (tx) => {
    const bin = await loadBin(tx, input.binId);
    const up = input.delta > 0;
    const movement = await insertMovement(
      tx,
      { ...input, quantity },
      {
        type: 'adjust',
        darkStoreId: bin.darkStoreId,
        fromBinId: up ? null : bin.id,
        toBinId: up ? bin.id : null,
      },
    );
    const binAfter = up
      ? await addToBin(tx, bin.id, input.skuId, quantity)
      : await takeFromBin(tx, bin.id, input.skuId, quantity);
    const level =
      bin.type === 'pickable'
        ? await changeLevel(
            tx,
            bin.darkStoreId,
            input.skuId,
            input.delta,
            0,
            'would_break_reservations',
          )
        : null;
    await audit(tx, movement, level, bin.type === 'pickable' ? input.delta : 0, 0, {
      [bin.code]: binAfter,
    });
    return { movement, level };
  });
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function assertQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new StockError('invalid_quantity');
}

async function run(
  db: Db,
  input: Pick<Common, 'idempotencyKey'>,
  fn: (tx: Tx) => Promise<Omit<StockResult, 'replayed'>>,
): Promise<StockResult> {
  const key = input.idempotencyKey;
  if (key) {
    const existing = await db.stockMovement.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { movement: existing, level: null, replayed: true };
  }
  try {
    return { ...(await inTransaction(db, fn)), replayed: false };
  } catch (error) {
    // Two calls with the same key at the same time: the second one loses the race on the
    // unique index and returns the first one's movement.
    if (key && isUniqueViolation(error) && '$transaction' in db) {
      const existing = await db.stockMovement.findUnique({ where: { idempotencyKey: key } });
      if (existing) return { movement: existing, level: null, replayed: true };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function loadBin(tx: Tx, id: string): Promise<Bin> {
  const bin = await tx.bin.findUnique({ where: { id } });
  if (!bin) throw new StockError('bin_not_found');
  if (!bin.isActive) throw new StockError('bin_inactive');
  return bin;
}

function insertMovement(
  tx: Tx,
  input: Common,
  data: {
    type: MovementType;
    darkStoreId: string;
    fromBinId?: string | null;
    toBinId?: string | null;
    orderId?: string;
    manifestId?: string;
    returnId?: string;
  },
) {
  return tx.stockMovement.create({
    data: {
      ...data,
      skuId: input.skuId,
      quantity: input.quantity,
      reason: input.reason,
      actorUserId: input.actorUserId ?? null,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

async function addToBin(tx: Tx, binId: string, skuId: string, quantity: number) {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    INSERT INTO bin_stock (bin_id, sku_id, quantity, updated_at)
    VALUES (${binId}, ${skuId}, ${quantity}, now())
    ON CONFLICT (bin_id, sku_id)
    DO UPDATE SET quantity = bin_stock.quantity + EXCLUDED.quantity, updated_at = now()
    RETURNING quantity`;
  return rows[0]!.quantity;
}

async function takeFromBin(tx: Tx, binId: string, skuId: string, quantity: number) {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    UPDATE bin_stock SET quantity = quantity - ${quantity}, updated_at = now()
    WHERE bin_id = ${binId} AND sku_id = ${skuId} AND quantity >= ${quantity}
    RETURNING quantity`;
  if (rows.length === 0) throw new StockError('insufficient_bin_stock');
  return rows[0]!.quantity;
}

/**
 * Applies deltas to a store level. Increases of on_hand create the row if needed; any
 * change that would make on_hand or reserved negative, or reserved exceed on_hand, is
 * refused with `failure`.
 */
async function changeLevel(
  tx: Tx,
  darkStoreId: string,
  skuId: string,
  onHandDelta: number,
  reservedDelta: number,
  failure: 'insufficient_stock' | 'insufficient_reserved' | 'would_break_reservations',
): Promise<Level> {
  if (onHandDelta > 0 && reservedDelta === 0) {
    const rows = await tx.$queryRaw<Level[]>`
      INSERT INTO stock_levels (dark_store_id, sku_id, on_hand, reserved, updated_at)
      VALUES (${darkStoreId}, ${skuId}, ${onHandDelta}, 0, now())
      ON CONFLICT (dark_store_id, sku_id)
      DO UPDATE SET on_hand = stock_levels.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand AS "onHand", reserved`;
    return rows[0]!;
  }
  const rows = await tx.$queryRaw<Level[]>`
    UPDATE stock_levels
    SET on_hand = on_hand + ${onHandDelta}, reserved = reserved + ${reservedDelta}, updated_at = now()
    WHERE dark_store_id = ${darkStoreId} AND sku_id = ${skuId}
      AND on_hand + ${onHandDelta} >= 0
      AND reserved + ${reservedDelta} >= 0
      AND reserved + ${reservedDelta} <= on_hand + ${onHandDelta}
    RETURNING on_hand AS "onHand", reserved`;
  if (rows.length === 0) throw new StockError(failure);
  return rows[0]!;
}

function audit(
  tx: Tx,
  movement: StockMovement,
  level: Level | null,
  onHandDelta: number,
  reservedDelta: number,
  binsAfter?: Record<string, number>,
) {
  const binsBefore = binsAfter && beforeBins(movement, binsAfter);
  return recordAudit(tx, {
    actorUserId: movement.actorUserId,
    action: `stock.${movement.type}`,
    entityType: 'stock_level',
    entityId: `${movement.darkStoreId}:${movement.skuId}`,
    before: {
      ...(level && {
        onHand: level.onHand - onHandDelta,
        reserved: level.reserved - reservedDelta,
      }),
      ...(binsBefore && { bins: binsBefore }),
    },
    after: {
      movementId: movement.id,
      ...(level && { onHand: level.onHand, reserved: level.reserved }),
      ...(binsAfter && { bins: binsAfter }),
    },
  });
}

/** Bin quantities before the movement, from the quantities after it. */
function beforeBins(movement: StockMovement, after: Record<string, number>) {
  const entries = Object.entries(after);
  // Bins are listed source first for a move, so the first entry lost units and the
  // second gained them. A single bin gained units if it is the movement's to_bin.
  if (entries.length === 2) {
    const [[fromCode, fromQty], [toCode, toQty]] = entries as [[string, number], [string, number]];
    return { [fromCode]: fromQty + movement.quantity, [toCode]: toQty - movement.quantity };
  }
  const [[code, qty]] = entries as [[string, number]];
  return { [code]: movement.toBinId ? qty - movement.quantity : qty + movement.quantity };
}
