import type { PackagingMovementType, Prisma } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { balanceOf, ensureDefaultAccounts, post } from './finance/ledger';
import { getSetting } from './settings';

type Tx = Prisma.TransactionClient;

// Packaging stock: the bags, boxes, labels and tape we buy and use when packing. It is ours,
// not a merchant's, so it never touches stock_movements: every change is one append only
// packaging_movements row, written in the same transaction as the level it changes. Each
// store's level keeps its units and their value (average cost), so what an order uses costs
// exactly its share and the last unit takes whatever value is left.
//
//   bought (paid now):   Dr 1402 Packaging stock   Cr bank or cash box
//   bought (PO receipt): Dr 1402 Packaging stock   Cr 2401 Goods received, not billed
//   used at packing:     Dr 5404 Packaging         Cr 1402 Packaging stock  (store and order tags)
//   lost or found:       Dr/Cr 5404 Packaging      Cr/Dr 1402 Packaging stock
//
// Packing is never blocked by missing packaging: what the store holds is used and booked,
// the rest is recorded as short on the order with one packaging_short alert.

const PACKAGING_EXPENSE_KEY = 'expense:packaging';

/** The 5404 Packaging expense account (an opening account; created if missing). */
export async function packagingExpense(tx: Tx) {
  let account = await tx.ledgerAccount.findUnique({ where: { key: PACKAGING_EXPENSE_KEY } });
  if (!account) {
    await ensureDefaultAccounts(tx);
    account = await tx.ledgerAccount.findUniqueOrThrow({ where: { key: PACKAGING_EXPENSE_KEY } });
  }
  return { id: account.id };
}

// ─── items ─────────────────────────────────────────────────────────────────────

export interface PackagingItemInput {
  code: string;
  nameEn: string;
  nameAr: string;
  unit?: string;
  unitCostPiastres?: number;
  isBox?: boolean;
  actorUserId: string;
}

export async function createPackagingItem(db: Db, input: PackagingItemInput) {
  return inTransaction(db, async (tx) => {
    if (await tx.packagingItem.findUnique({ where: { code: input.code } }))
      throw new DomainError('packaging_item_exists');
    const item = await tx.packagingItem.create({
      data: {
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        unit: input.unit ?? 'piece',
        unitCostPiastres: input.unitCostPiastres ?? 0,
        isBox: input.isBox ?? false,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'packaging.item_create',
      entityType: 'packaging_item',
      entityId: item.id,
      after: { code: item.code, nameEn: item.nameEn, cost: item.unitCostPiastres },
    });
    return item;
  });
}

export async function updatePackagingItem(
  db: Db,
  input: Partial<Omit<PackagingItemInput, 'code' | 'actorUserId'>> & {
    itemId: string;
    isActive?: boolean;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.packagingItem.findUnique({ where: { id: input.itemId } });
    if (!before) throw new DomainError('packaging_item_not_found', 404);
    const after = await tx.packagingItem.update({
      where: { id: before.id },
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        unit: input.unit,
        unitCostPiastres: input.unitCostPiastres,
        isBox: input.isBox,
        isActive: input.isActive,
      },
    });
    const pick = (i: typeof before) => ({
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      unit: i.unit,
      cost: i.unitCostPiastres,
      isBox: i.isBox,
      isActive: i.isActive,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'packaging.item_update',
      entityType: 'packaging_item',
      entityId: before.id,
      before: pick(before),
      after: pick(after),
    });
    return after;
  });
}

export function listPackagingItems(db: Db, opts: { activeOnly?: boolean } = {}) {
  return db.packagingItem.findMany({
    where: opts.activeOnly ? { isActive: true } : {},
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
  });
}

// ─── levels and movements ──────────────────────────────────────────────────────

/** The store's level of an item, created empty if needed and locked for this transaction. */
async function lockLevel(tx: Tx, darkStoreId: string, itemId: string) {
  await tx.$executeRaw`
    INSERT INTO packaging_levels (id, dark_store_id, item_id, on_hand, value_piastres, updated_at)
    VALUES (${`pl_${darkStoreId}_${itemId}`}, ${darkStoreId}, ${itemId}, 0, 0, now())
    ON CONFLICT (dark_store_id, item_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string; on_hand: number; value_piastres: number }[]>`
    SELECT id, on_hand, value_piastres FROM packaging_levels
    WHERE dark_store_id = ${darkStoreId} AND item_id = ${itemId} FOR UPDATE`;
  const row = rows[0]!;
  return { id: row.id, onHand: row.on_hand, value: row.value_piastres };
}

/** The value of `quantity` units taken from a level: its share, or all that is left. */
export function valueOut(level: { onHand: number; value: number }, quantity: number) {
  if (quantity >= level.onHand) return level.value;
  return Math.round((level.value * quantity) / level.onHand);
}

async function checkStoreAndItem(tx: Tx, darkStoreId: string, itemId: string) {
  const [store, item] = await Promise.all([
    tx.darkStore.findUnique({ where: { id: darkStoreId }, select: { id: true } }),
    tx.packagingItem.findUnique({ where: { id: itemId } }),
  ]);
  if (!store) throw new DomainError('store_not_found', 404);
  if (!item) throw new DomainError('packaging_item_not_found', 404);
  return item;
}

interface MoveInput {
  darkStoreId: string;
  itemId: string;
  type: PackagingMovementType;
  /** Signed units */
  quantity: number;
  /** Signed value */
  value: number;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  entryId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
  actorUserId?: string | null;
}

/** Writes the movement first, then changes the level with a guarded update (never below zero). */
async function move(tx: Tx, input: MoveInput) {
  const movement = await tx.packagingMovement.create({
    data: {
      darkStoreId: input.darkStoreId,
      itemId: input.itemId,
      type: input.type,
      quantity: input.quantity,
      valuePiastres: input.value,
      orderId: input.orderId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      entryId: input.entryId ?? null,
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey,
      createdById: input.actorUserId ?? null,
    },
  });
  const changed = await tx.$executeRaw`
    UPDATE packaging_levels
    SET on_hand = on_hand + ${input.quantity}, value_piastres = value_piastres + ${input.value},
        updated_at = now()
    WHERE dark_store_id = ${input.darkStoreId} AND item_id = ${input.itemId}
      AND on_hand + ${input.quantity} >= 0 AND value_piastres + ${input.value} >= 0`;
  if (changed !== 1) throw new DomainError('packaging_not_enough');
  return movement;
}

/** Raises one packaging_low alert per store and item while it is at or below the setting. */
async function checkLow(tx: Tx, darkStoreId: string, itemId: string) {
  const limit = await getSetting(tx, 'stock.packaging_low_units', darkStoreId);
  if (limit <= 0) return;
  const level = await tx.packagingLevel.findUnique({
    where: { darkStoreId_itemId: { darkStoreId, itemId } },
    include: { item: { select: { code: true, isActive: true } } },
  });
  if (!level || !level.item.isActive || level.onHand > limit) return;
  const open = await tx.alert.findFirst({
    where: {
      type: 'packaging_low',
      darkStoreId,
      resolvedAt: null,
      data: { path: ['itemId'], equals: itemId },
    },
  });
  if (open) return;
  await tx.alert.create({
    data: {
      type: 'packaging_low',
      darkStoreId,
      data: { itemId, code: level.item.code, onHand: level.onHand, limit },
    },
  });
}

/**
 * Units arriving at a store with their value (no ledger posting: the caller books the other
 * side). Updates the item's last unit cost. Safe to repeat with the same idempotency key.
 */
export async function receivePackagingUnits(
  tx: Tx,
  input: {
    darkStoreId: string;
    itemId: string;
    quantity: number;
    valuePiastres: number;
    purchaseOrderId?: string | null;
    entryId?: string | null;
    reason?: string | null;
    idempotencyKey: string;
    actorUserId: string;
  },
) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)
    throw new DomainError('invalid_quantity', 400);
  if (!Number.isSafeInteger(input.valuePiastres) || input.valuePiastres < 0)
    throw new DomainError('invalid_amount', 400);
  const seen = await tx.packagingMovement.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (seen) return seen;
  await checkStoreAndItem(tx, input.darkStoreId, input.itemId);
  await lockLevel(tx, input.darkStoreId, input.itemId);
  const movement = await move(tx, {
    ...input,
    type: 'receive',
    value: input.valuePiastres,
  });
  await tx.packagingItem.update({
    where: { id: input.itemId },
    data: { unitCostPiastres: Math.round(input.valuePiastres / input.quantity) },
  });
  return movement;
}

export interface PackagingPurchaseInput {
  darkStoreId: string;
  itemId: string;
  quantity: number;
  /** What was paid for all the units, before VAT */
  amountPiastres: number;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Packaging bought and paid at once from a bank or cash box (second person rule above the limit). */
export async function recordPackagingPurchase(db: Db, input: PackagingPurchaseInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const key = `packaging_purchase:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const item = await checkStoreAndItem(tx, input.darkStoreId, input.itemId);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ledger_accounts WHERE id = ${input.moneyAccountId} FOR UPDATE`;
    const money = rows.length
      ? await tx.ledgerAccount.findUnique({ where: { id: input.moneyAccountId } })
      : null;
    if (!money || ![1100, 1200].includes(money.groupCode))
      throw new DomainError('account_not_found', 404);
    if (!money.isActive) throw new DomainError('account_inactive');
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'packaging_purchase',
      idempotencyKey: key,
      createdById: input.actorUserId,
      memo: `${item.code} × ${input.quantity} ${input.reference}`,
      darkStoreId: input.darkStoreId,
      data: {
        itemId: item.id,
        quantity: input.quantity,
        reference: input.reference,
        darkStoreId: input.darkStoreId,
      },
      lines: [
        { account: { type: 'packaging_stock' }, amount: input.amountPiastres },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    await receivePackagingUnits(tx, {
      darkStoreId: input.darkStoreId,
      itemId: item.id,
      quantity: input.quantity,
      valuePiastres: input.amountPiastres,
      entryId: entry!.id,
      reason: input.reference,
      idempotencyKey: key,
      actorUserId: input.actorUserId,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'packaging.purchase',
      entityType: 'packaging_item',
      entityId: item.id,
      after: {
        store: input.darkStoreId,
        quantity: input.quantity,
        amount: input.amountPiastres,
        from: money.code,
        entry: entry!.number,
      },
    });
    return entry!;
  });
}

/**
 * Units found (positive) or lost, damaged or given away (negative), with a reason. Lost units
 * leave at their average cost; found units come in at the item's unit cost.
 */
export async function adjustPackaging(
  db: Db,
  input: {
    darkStoreId: string;
    itemId: string;
    quantity: number;
    reason: string;
    type?: 'adjust' | 'count';
    idempotencyKey: string;
    actorUserId: string;
  },
) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0)
    throw new DomainError('invalid_quantity', 400);
  if (input.reason.trim().length < 3) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    const key = `packaging_adjust:${input.idempotencyKey}`;
    const seen = await tx.packagingMovement.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const item = await checkStoreAndItem(tx, input.darkStoreId, input.itemId);
    const level = await lockLevel(tx, input.darkStoreId, input.itemId);
    if (input.quantity < 0 && -input.quantity > level.onHand)
      throw new DomainError('packaging_not_enough');
    const value =
      input.quantity < 0
        ? -valueOut(level, -input.quantity)
        : input.quantity * item.unitCostPiastres;
    const expense = await packagingExpense(tx);
    const entry = await post(tx, {
      kind: 'packaging_adjustment',
      idempotencyKey: key,
      createdById: input.actorUserId,
      memo: `${item.code} ${input.quantity > 0 ? '+' : ''}${input.quantity}: ${input.reason}`,
      darkStoreId: input.darkStoreId,
      data: { itemId: item.id, quantity: input.quantity, reason: input.reason },
      lines: [
        { account: { type: 'packaging_stock' }, amount: value },
        { account: expense, amount: -value },
      ],
    });
    const movement = await move(tx, {
      darkStoreId: input.darkStoreId,
      itemId: item.id,
      type: input.type ?? 'adjust',
      quantity: input.quantity,
      value,
      entryId: entry?.id ?? null,
      reason: input.reason,
      idempotencyKey: key,
      actorUserId: input.actorUserId,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.type === 'count' ? 'packaging.count' : 'packaging.adjust',
      entityType: 'packaging_item',
      entityId: item.id,
      before: { store: input.darkStoreId, onHand: level.onHand, value: level.value },
      after: {
        store: input.darkStoreId,
        onHand: level.onHand + input.quantity,
        value: level.value + value,
        reason: input.reason,
      },
    });
    if (input.quantity < 0) await checkLow(tx, input.darkStoreId, item.id);
    return movement;
  });
}

/** A counted number of units: the difference is adjusted (nothing happens when it matches). */
export async function countPackaging(
  db: Db,
  input: {
    darkStoreId: string;
    itemId: string;
    counted: number;
    idempotencyKey: string;
    actorUserId: string;
  },
) {
  if (!Number.isSafeInteger(input.counted) || input.counted < 0)
    throw new DomainError('invalid_quantity', 400);
  return inTransaction(db, async (tx) => {
    const seen = await tx.packagingMovement.findUnique({
      where: { idempotencyKey: `packaging_adjust:${input.idempotencyKey}` },
    });
    if (seen) return { difference: seen.quantity };
    await checkStoreAndItem(tx, input.darkStoreId, input.itemId);
    const level = await lockLevel(tx, input.darkStoreId, input.itemId);
    const difference = input.counted - level.onHand;
    if (difference === 0) return { difference: 0 };
    await adjustPackaging(tx, {
      darkStoreId: input.darkStoreId,
      itemId: input.itemId,
      quantity: difference,
      reason: `count ${input.counted}`,
      type: 'count',
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
    });
    return { difference };
  });
}

/** Every store's packaging, per item, with what is low (at or below the store's setting). */
export async function packagingStock(db: Db, filter: { darkStoreId?: string } = {}) {
  const [stores, items, levels] = await Promise.all([
    db.darkStore.findMany({
      where: { id: filter.darkStoreId, kind: 'dark_store' },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    }),
    db.packagingItem.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    db.packagingLevel.findMany({ where: { darkStoreId: filter.darkStoreId } }),
  ]);
  const rows = [];
  for (const store of stores) {
    const limit = await getSetting(db, 'stock.packaging_low_units', store.id);
    for (const item of items) {
      const level = levels.find((l) => l.darkStoreId === store.id && l.itemId === item.id);
      const onHand = level?.onHand ?? 0;
      rows.push({
        store,
        item: {
          id: item.id,
          code: item.code,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          unit: item.unit,
        },
        onHand,
        valuePiastres: level?.valuePiastres ?? 0,
        averageCostPiastres: onHand > 0 ? Math.round(level!.valuePiastres / onHand) : null,
        low: limit > 0 && onHand <= limit,
        limit,
      });
    }
  }
  return {
    rows,
    totalValuePiastres: rows.reduce((s, r) => s + r.valuePiastres, 0),
  };
}

/** The latest packaging movements, newest first. */
export async function listPackagingMovements(
  db: Db,
  filter: { darkStoreId?: string; itemId?: string; orderId?: string; take?: number } = {},
) {
  return db.packagingMovement.findMany({
    where: { darkStoreId: filter.darkStoreId, itemId: filter.itemId, orderId: filter.orderId },
    include: { item: { select: { code: true, nameEn: true, nameAr: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.take ?? 100, 500),
  });
}

// ─── recipes and use at packing ────────────────────────────────────────────────

/**
 * Replaces the packaging one order uses for a scope: a merchant at a store, a merchant, a
 * store, or everyone (both empty). An empty list removes the scope's recipe.
 */
export async function setPackagingRecipe(
  db: Db,
  input: {
    darkStoreId?: string | null;
    merchantId?: string | null;
    lines: { itemId: string; quantity: number }[];
    actorUserId: string;
  },
) {
  const darkStoreId = input.darkStoreId || null;
  const merchantId = input.merchantId || null;
  const ids = input.lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length) throw new DomainError('duplicate_item', 400);
  return inTransaction(db, async (tx) => {
    if (darkStoreId && !(await tx.darkStore.findUnique({ where: { id: darkStoreId } })))
      throw new DomainError('store_not_found', 404);
    if (merchantId && !(await tx.merchant.findUnique({ where: { id: merchantId } })))
      throw new DomainError('merchant_not_found', 404);
    const found = await tx.packagingItem.count({ where: { id: { in: ids }, isActive: true } });
    if (found !== ids.length) throw new DomainError('packaging_item_not_found', 404);
    const before = await tx.packagingRecipe.findMany({ where: { darkStoreId, merchantId } });
    await tx.packagingRecipe.deleteMany({ where: { darkStoreId, merchantId } });
    if (input.lines.length)
      await tx.packagingRecipe.createMany({
        data: input.lines.map((l) => ({
          darkStoreId,
          merchantId,
          itemId: l.itemId,
          quantity: l.quantity,
        })),
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'packaging.recipe_set',
      entityType: 'packaging_recipe',
      entityId: `${darkStoreId ?? '*'}:${merchantId ?? '*'}`,
      before: { lines: before.map((r) => ({ itemId: r.itemId, quantity: r.quantity })) },
      after: { lines: input.lines },
    });
    return { darkStoreId, merchantId, lines: input.lines };
  });
}

export async function listPackagingRecipes(db: Db) {
  const rows = await db.packagingRecipe.findMany({
    include: { item: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const scopes = new Map<
    string,
    {
      darkStoreId: string | null;
      merchantId: string | null;
      lines: { itemId: string; code: string; nameEn: string; nameAr: string; quantity: number }[];
    }
  >();
  for (const r of rows) {
    const k = `${r.darkStoreId ?? ''}:${r.merchantId ?? ''}`;
    const scope = scopes.get(k) ?? {
      darkStoreId: r.darkStoreId,
      merchantId: r.merchantId,
      lines: [],
    };
    scope.lines.push({
      itemId: r.itemId,
      code: r.item.code,
      nameEn: r.item.nameEn,
      nameAr: r.item.nameAr,
      quantity: r.quantity,
    });
    scopes.set(k, scope);
  }
  return [...scopes.values()];
}

/**
 * What one order uses: the most specific recipe that exists (the merchant at this store, the
 * merchant anywhere, this store, then everyone). Recipes are not added together.
 */
export async function recipeFor(db: Db, darkStoreId: string, merchantId: string) {
  const rows = await db.packagingRecipe.findMany({
    where: {
      OR: [
        { darkStoreId, merchantId },
        { darkStoreId: null, merchantId },
        { darkStoreId, merchantId: null },
        { darkStoreId: null, merchantId: null },
      ],
      item: { isActive: true },
    },
  });
  const levels: [string | null, string | null][] = [
    [darkStoreId, merchantId],
    [null, merchantId],
    [darkStoreId, null],
    [null, null],
  ];
  for (const [store, merchant] of levels) {
    const lines = rows.filter((r) => r.darkStoreId === store && r.merchantId === merchant);
    if (lines.length) return lines.map((r) => ({ itemId: r.itemId, quantity: r.quantity }));
  }
  return [];
}

/**
 * Called by packOrder inside its transaction: lowers packaging stock by the order's recipe
 * plus the box staff chose, and books what it cost (5404 against 1402, tagged with the store
 * and the order). Never blocks packing: units the store lacks are recorded as short with one
 * packaging_short alert. Runs once per order (the order can be packed once).
 */
export async function consumePackagingForOrder(
  tx: Tx,
  input: {
    orderId: string;
    orderNumber: string;
    darkStoreId: string;
    merchantId: string;
    boxItemId?: string | null;
    actorUserId: string | null;
  },
) {
  const needs = new Map<string, number>();
  for (const l of await recipeFor(tx, input.darkStoreId, input.merchantId))
    needs.set(l.itemId, (needs.get(l.itemId) ?? 0) + l.quantity);
  if (input.boxItemId) {
    const box = await tx.packagingItem.findUnique({ where: { id: input.boxItemId } });
    if (!box || !box.isActive || !box.isBox) throw new DomainError('box_not_found', 400);
    needs.set(box.id, (needs.get(box.id) ?? 0) + 1);
  }
  if (needs.size === 0)
    return { costPiastres: 0, short: [] as { itemId: string; quantity: number }[] };
  const used: { itemId: string; quantity: number; value: number }[] = [];
  const short: { itemId: string; quantity: number }[] = [];
  for (const [itemId, quantity] of [...needs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const level = await lockLevel(tx, input.darkStoreId, itemId);
    const take = Math.min(quantity, level.onHand);
    if (take < quantity) short.push({ itemId, quantity: quantity - take });
    if (take > 0) used.push({ itemId, quantity: take, value: valueOut(level, take) });
  }
  const cost = used.reduce((s, u) => s + u.value, 0);
  const entry =
    cost > 0
      ? await post(tx, {
          kind: 'packaging_used',
          idempotencyKey: `packaging:${input.orderId}`,
          createdById: input.actorUserId,
          memo: input.orderNumber,
          orderId: input.orderId,
          darkStoreId: input.darkStoreId,
          merchantId: input.merchantId,
          data: { used: used.map((u) => ({ itemId: u.itemId, quantity: u.quantity })) },
          lines: [
            { account: await packagingExpense(tx), amount: cost },
            { account: { type: 'packaging_stock' }, amount: -cost },
          ],
        })
      : null;
  for (const u of used)
    await move(tx, {
      darkStoreId: input.darkStoreId,
      itemId: u.itemId,
      type: 'consume',
      quantity: -u.quantity,
      value: -u.value,
      orderId: input.orderId,
      entryId: entry?.id ?? null,
      idempotencyKey: `packaging:${input.orderId}:${u.itemId}`,
      actorUserId: input.actorUserId,
    });
  if (short.length)
    await tx.alert.create({
      data: {
        type: 'packaging_short',
        key: `packaging_short:${input.orderId}`,
        darkStoreId: input.darkStoreId,
        orderId: input.orderId,
        data: { short },
      },
    });
  for (const u of used) await checkLow(tx, input.darkStoreId, u.itemId);
  if (input.actorUserId)
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'packaging.consume',
      entityType: 'order',
      entityId: input.orderId,
      after: { used, short, cost },
    });
  return { costPiastres: cost, short };
}

/** What packaging an order used and what it cost. */
export async function packagingForOrder(db: Db, orderId: string) {
  const rows = await db.packagingMovement.findMany({
    where: { orderId, type: 'consume' },
    include: { item: { select: { code: true, nameEn: true, nameAr: true } } },
  });
  return {
    lines: rows.map((r) => ({
      item: r.item,
      quantity: -r.quantity,
      valuePiastres: -r.valuePiastres,
    })),
    costPiastres: rows.reduce((s, r) => s - r.valuePiastres, 0),
  };
}
