import type { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { isCalendarDay, purchaseOrderNumber } from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { eventTime } from './finance/books';
import { nextNumber, post, share } from './finance/ledger';
import { packagingExpense, receivePackagingUnits } from './packaging';
import { getSetting } from './settings';

type Tx = Prisma.TransactionClient;

// Purchase orders: what we ask a supplier for, before the bill arrives.
//
//   requested ──approve (another person, from the approval limit)──▶ approved ──▶ ordered
//      │  (below the limit it is approved at once)                                 │
//      └──reject (with a note)                                       received (in parts)
//                                                                                   │
//                                         billed (the bill is made from the order) ─┘──▶ closed
//
// Receiving packaging adds packaging stock at the ordered price (Dr 1402 Packaging stock,
// Cr 2401 Goods received not billed). The bill made from the order clears 2401 for the
// packaging it covers and books other lines to their expense; a bill above the ordered
// prices by more than finance.po_bill_tolerance_bp is refused, and whatever the bill differs
// within it goes to the expense of the order (5404 Packaging when it is all packaging).

const EXPENSE_GROUPS = [5400, 5500];

async function lockOrder(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new DomainError('purchase_order_not_found', 404);
  return tx.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  });
}

const label = (n: number) => purchaseOrderNumber(n);

export interface PurchaseOrderInput {
  supplierId: string;
  darkStoreId?: string | null;
  note?: string | null;
  quotePhotoId?: string | null;
  lines: {
    packagingItemId?: string;
    expenseAccountId?: string;
    description: string;
    quantity: number;
    unitPricePiastres: number;
  }[];
  idempotencyKey: string;
  actorUserId: string;
}

/**
 * Asks for a purchase. Below the approval limit it is approved at once; from it, another
 * person with the approve level decides (finance.approval_threshold_piastres, 0 turns it off).
 */
export async function requestPurchaseOrder(db: Db, input: PurchaseOrderInput) {
  if (!input.lines.length) throw new DomainError('lines_required', 400);
  for (const l of input.lines) {
    if (!!l.packagingItemId === !!l.expenseAccountId)
      throw new DomainError('packaging_or_expense', 400);
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0)
      throw new DomainError('invalid_quantity', 400);
    if (!Number.isSafeInteger(l.unitPricePiastres) || l.unitPricePiastres < 0)
      throw new DomainError('invalid_amount', 400);
  }
  const total = input.lines.reduce((s, l) => s + l.quantity * l.unitPricePiastres, 0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const seen = await tx.auditLog.findFirst({
      where: {
        action: 'purchase_order.request',
        after: { path: ['key'], equals: input.idempotencyKey },
      },
    });
    if (seen?.entityId) return tx.purchaseOrder.findUniqueOrThrow({ where: { id: seen.entityId } });
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || !supplier.isActive) throw new DomainError('supplier_not_found', 404);
    const darkStoreId = input.darkStoreId || null;
    if (darkStoreId && !(await tx.darkStore.findUnique({ where: { id: darkStoreId } })))
      throw new DomainError('store_not_found', 404);
    const packaging = input.lines.filter((l) => l.packagingItemId);
    // Packaging is received into one store's packaging stock.
    if (packaging.length && !darkStoreId) throw new DomainError('store_required', 400);
    const items = await tx.packagingItem.findMany({
      where: { id: { in: packaging.map((l) => l.packagingItemId!) }, isActive: true },
    });
    if (items.length !== new Set(packaging.map((l) => l.packagingItemId)).size)
      throw new DomainError('packaging_item_not_found', 404);
    const expenseIds = input.lines.flatMap((l) => (l.expenseAccountId ? [l.expenseAccountId] : []));
    const expenses = await tx.ledgerAccount.findMany({
      where: { id: { in: expenseIds }, isActive: true, groupCode: { in: EXPENSE_GROUPS } },
    });
    if (expenses.length !== new Set(expenseIds).size)
      throw new DomainError('expense_account_not_found', 404);
    if (input.quotePhotoId) {
      const photo = await tx.photo.findUnique({ where: { id: input.quotePhotoId } });
      if (!photo || photo.kind !== 'receipt') throw new DomainError('photo_not_found', 404);
    }
    const limit = await getSetting(tx, 'finance.approval_threshold_piastres');
    const needsApproval = limit > 0 && total >= limit;
    const order = await tx.purchaseOrder.create({
      data: {
        number: await nextNumber(tx, 'purchase_orders'),
        supplierId: supplier.id,
        darkStoreId,
        status: needsApproval ? 'requested' : 'approved',
        totalPiastres: total,
        note: input.note || null,
        quotePhotoId: input.quotePhotoId || null,
        requestedById: input.actorUserId,
        decidedAt: needsApproval ? null : new Date(),
        lines: {
          create: input.lines.map((l, i) => ({
            lineNo: i + 1,
            packagingItemId: l.packagingItemId ?? null,
            expenseAccountId: l.expenseAccountId ?? null,
            description: l.description.trim(),
            quantity: l.quantity,
            unitPricePiastres: l.unitPricePiastres,
          })),
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'purchase_order.request',
      entityType: 'purchase_order',
      entityId: order.id,
      after: {
        key: input.idempotencyKey,
        number: label(order.number),
        supplier: supplier.name,
        total,
        status: order.status,
        lines: input.lines.length,
      },
    });
    return order;
  });
}

/** Another person approves or rejects (with a note) a purchase order waiting for approval. */
export async function decidePurchaseOrder(
  db: Db,
  input: { purchaseOrderId: string; approve: boolean; note?: string; actorUserId: string },
) {
  const note = input.note?.trim() || null;
  if (!input.approve && !note) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.purchaseOrderId);
    if (order.status !== 'requested') throw new DomainError('purchase_order_not_waiting');
    if (order.requestedById === input.actorUserId) throw new DomainError('same_person', 403);
    const status: PurchaseOrderStatus = input.approve ? 'approved' : 'rejected';
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status, decidedById: input.actorUserId, decidedAt: new Date(), decisionNote: note },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.approve ? 'purchase_order.approve' : 'purchase_order.reject',
      entityType: 'purchase_order',
      entityId: order.id,
      before: { status: order.status },
      after: { status, note },
    });
    return { status };
  });
}

/** The order was sent to the supplier. */
export async function markPurchaseOrdered(
  db: Db,
  input: { purchaseOrderId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.purchaseOrderId);
    if (order.status !== 'approved') throw new DomainError('purchase_order_not_approved');
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: 'ordered', orderedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'purchase_order.ordered',
      entityType: 'purchase_order',
      entityId: order.id,
      before: { status: order.status },
      after: { status: 'ordered' },
    });
    return { status: 'ordered' as const };
  });
}

/**
 * Goods arrived (all or part). Packaging lines go into the order's store at the ordered
 * price; once every line is complete the order is received. A delivery is kept once per key.
 */
export async function receivePurchaseOrder(
  db: Db,
  input: {
    purchaseOrderId: string;
    lines: { lineId: string; quantity: number }[];
    idempotencyKey: string;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const key = `po_receipt:${input.idempotencyKey}`;
    const seen = await tx.purchaseOrderReceipt.findUnique({ where: { idempotencyKey: key } });
    if (seen) return { replayed: true, status: null };
    const order = await lockOrder(tx, input.purchaseOrderId);
    // Goods can still arrive after a partial bill, until everything ordered is received.
    if (order.status !== 'ordered') throw new DomainError('purchase_order_not_ordered');
    const ids = input.lines.map((l) => l.lineId);
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new DomainError('invalid_lines', 400);
    let value = 0;
    const changes: { line: (typeof order.lines)[number]; quantity: number }[] = [];
    for (const l of input.lines) {
      const line = order.lines.find((x) => x.id === l.lineId);
      if (!line) throw new DomainError('line_not_found', 404);
      if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0)
        throw new DomainError('invalid_quantity', 400);
      if (line.receivedQty + l.quantity > line.quantity)
        throw new DomainError('more_than_ordered', 400);
      changes.push({ line, quantity: l.quantity });
      if (line.packagingItemId) value += l.quantity * line.unitPricePiastres;
    }
    const entry = await post(tx, {
      kind: 'po_receipt',
      idempotencyKey: key,
      createdById: input.actorUserId,
      memo: `${label(order.number)} ${order.supplier.name}`,
      darkStoreId: order.darkStoreId,
      data: { purchaseOrderId: order.id },
      lines: [
        { account: { type: 'packaging_stock' }, amount: value },
        { account: { type: 'goods_received' }, amount: -value },
      ],
    });
    for (const { line, quantity } of changes) {
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: { increment: quantity } },
      });
      if (line.packagingItemId)
        await receivePackagingUnits(tx, {
          darkStoreId: order.darkStoreId!,
          itemId: line.packagingItemId,
          quantity,
          valuePiastres: quantity * line.unitPricePiastres,
          purchaseOrderId: order.id,
          entryId: entry?.id ?? null,
          reason: label(order.number),
          idempotencyKey: `${key}:${line.id}`,
          actorUserId: input.actorUserId,
        });
    }
    await tx.purchaseOrderReceipt.create({
      data: {
        purchaseOrderId: order.id,
        lines: input.lines,
        valuePiastres: value,
        entryId: entry?.id ?? null,
        idempotencyKey: key,
        createdById: input.actorUserId,
      },
    });
    const complete = order.lines.every((line) => {
      const added = changes.find((c) => c.line.id === line.id)?.quantity ?? 0;
      return line.receivedQty + added === line.quantity;
    });
    const status: PurchaseOrderStatus = complete ? 'received' : 'ordered';
    if (complete) await tx.purchaseOrder.update({ where: { id: order.id }, data: { status } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'purchase_order.receive',
      entityType: 'purchase_order',
      entityId: order.id,
      before: { status: order.status },
      after: { status, lines: input.lines, value },
    });
    return { replayed: false, status };
  });
}

export interface PurchaseOrderBillInput {
  purchaseOrderId: string;
  reference: string;
  billDate: string;
  dueDate: string;
  netPiastres: number;
  vatPiastres?: number;
  idempotencyKey: string;
  actorUserId: string;
}

/**
 * The supplier's bill for what was received and not billed yet, made from the order: the
 * lines decide the accounts. Refused when it is above the ordered prices by more than the
 * tolerance; paid like any bill afterwards.
 */
export async function billPurchaseOrder(db: Db, input: PurchaseOrderBillInput) {
  const net = input.netPiastres;
  const vat = input.vatPiastres ?? 0;
  if (!Number.isSafeInteger(net) || net <= 0) throw new DomainError('invalid_amount', 400);
  if (!Number.isSafeInteger(vat) || vat < 0) throw new DomainError('invalid_vat', 400);
  if (!isCalendarDay(input.billDate) || !isCalendarDay(input.dueDate))
    throw new DomainError('invalid_date', 400);
  if (input.dueDate < input.billDate) throw new DomainError('due_before_bill', 400);
  const at = eventTime(input.billDate);
  return inTransaction(db, async (tx) => {
    const key = `bill:po:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return tx.bill.findFirstOrThrow({ where: { entryId: seen.id } });
    const order = await lockOrder(tx, input.purchaseOrderId);
    if (order.status !== 'ordered' && order.status !== 'received')
      throw new DomainError('purchase_order_not_billable');
    const open = order.lines
      .map((l) => ({ line: l, quantity: l.receivedQty - l.billedQty }))
      .filter((x) => x.quantity > 0);
    if (!open.length) throw new DomainError('nothing_to_bill');
    const expected = open.reduce((s, x) => s + x.quantity * x.line.unitPricePiastres, 0);
    const tolerance = await getSetting(tx, 'finance.po_bill_tolerance_bp');
    if (net > expected + share(expected, tolerance)) throw new DomainError('bill_above_order');
    const reference = input.reference.trim();
    if (
      await tx.bill.findFirst({ where: { supplierId: order.supplierId, reference, userId: null } })
    )
      throw new DomainError('bill_exists');
    // Debits per account at the ordered prices, then the difference on the order's expense.
    const debits = new Map<
      string,
      { account: { id: string } | { type: 'goods_received' }; amount: number }
    >();
    for (const { line, quantity } of open) {
      const k = line.packagingItemId ? 'goods_received' : line.expenseAccountId!;
      const row = debits.get(k) ?? {
        account: line.packagingItemId ? { type: 'goods_received' as const } : { id: k },
        amount: 0,
      };
      row.amount += quantity * line.unitPricePiastres;
      debits.set(k, row);
    }
    const firstExpense = open.find((x) => x.line.expenseAccountId)?.line.expenseAccountId;
    const differenceAccount = firstExpense ? { id: firstExpense } : await packagingExpense(tx);
    const total = net + vat;
    const entry = await post(tx, {
      kind: 'supplier_bill',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${order.supplier.name} ${reference} (${label(order.number)})`,
      darkStoreId: order.darkStoreId,
      data: {
        supplierId: order.supplierId,
        reference,
        vat,
        userId: null,
        purchaseOrderId: order.id,
        expected,
      },
      lines: [
        ...[...debits.values()].map((d) => ({ account: d.account, amount: d.amount })),
        { account: differenceAccount, amount: net - expected },
        { account: { type: 'vat_payable' as const }, amount: vat },
        { account: { type: 'supplier' as const, supplierId: order.supplierId }, amount: -total },
      ],
    });
    const mainAccount = firstExpense
      ? firstExpense
      : (await tx.ledgerAccount.findUniqueOrThrow({ where: { key: 'goods_received' } })).id;
    const bill = await tx.bill.create({
      data: {
        number: await nextNumber(tx, 'bills'),
        supplierId: order.supplierId,
        reference,
        billDate: new Date(`${input.billDate}T00:00:00Z`),
        dueDate: new Date(`${input.dueDate}T00:00:00Z`),
        expenseAccountId: mainAccount,
        darkStoreId: order.darkStoreId,
        netPiastres: net,
        vatPiastres: vat,
        totalPiastres: total,
        whtBp: order.supplier.whtBp,
        memo: label(order.number),
        entryId: entry!.id,
        purchaseOrderId: order.id,
        createdById: input.actorUserId,
      },
    });
    for (const { line, quantity } of open)
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { billedQty: { increment: quantity } },
      });
    const done = order.lines.every((l) => l.receivedQty === l.quantity);
    const status: PurchaseOrderStatus = done ? 'billed' : order.status;
    if (status !== order.status)
      await tx.purchaseOrder.update({ where: { id: order.id }, data: { status } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bill_create',
      entityType: 'bill',
      entityId: bill.id,
      after: {
        number: bill.number,
        purchaseOrder: label(order.number),
        reference,
        total,
        expected,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'purchase_order.bill',
      entityType: 'purchase_order',
      entityId: order.id,
      before: { status: order.status },
      after: { status, bill: bill.number, net, vat, expected },
    });
    return bill;
  });
}

/**
 * Ends an order: cancelled while nothing was received, otherwise closed (a short delivery is
 * closed once what came is billed). Needs a note.
 */
export async function closePurchaseOrder(
  db: Db,
  input: { purchaseOrderId: string; note: string; actorUserId: string },
) {
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.purchaseOrderId);
    if (['closed', 'rejected', 'cancelled'].includes(order.status))
      throw new DomainError('purchase_order_closed');
    const received = order.lines.some((l) => l.receivedQty > 0);
    if (order.lines.some((l) => l.receivedQty > l.billedQty))
      throw new DomainError('unbilled_receipts');
    const status: PurchaseOrderStatus = received ? 'closed' : 'cancelled';
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status, closedAt: new Date(), decisionNote: note },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: received ? 'purchase_order.close' : 'purchase_order.cancel',
      entityType: 'purchase_order',
      entityId: order.id,
      before: { status: order.status },
      after: { status, note },
    });
    return { status };
  });
}

export async function listPurchaseOrders(
  db: Db,
  filter: { status?: PurchaseOrderStatus; supplierId?: string } = {},
) {
  const rows = await db.purchaseOrder.findMany({
    where: { status: filter.status, supplierId: filter.supplierId },
    include: {
      supplier: { select: { id: true, name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      requestedBy: { select: { id: true, name: true } },
      lines: { select: { quantity: true, receivedQty: true, billedQty: true } },
    },
    orderBy: { number: 'desc' },
    take: 300,
  });
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    label: label(o.number),
    supplier: o.supplier,
    darkStore: o.darkStore,
    status: o.status,
    totalPiastres: o.totalPiastres,
    requestedBy: o.requestedBy,
    createdAt: o.createdAt,
    partlyReceived: o.lines.some((l) => l.receivedQty > 0 && l.receivedQty < l.quantity),
    receivedShare:
      o.lines.reduce((s, l) => s + l.receivedQty, 0) / o.lines.reduce((s, l) => s + l.quantity, 0),
  }));
}

export async function getPurchaseOrder(db: Db, id: string) {
  const o = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, whtBp: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          packagingItem: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          expenseAccount: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        },
      },
      bills: {
        select: {
          id: true,
          number: true,
          reference: true,
          netPiastres: true,
          vatPiastres: true,
          totalPiastres: true,
          paidPiastres: true,
          status: true,
          billDate: true,
        },
        orderBy: { number: 'asc' },
      },
      receipts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!o) throw new DomainError('purchase_order_not_found', 404);
  const unbilled = o.lines.reduce(
    (s, l) => s + (l.receivedQty - l.billedQty) * l.unitPricePiastres,
    0,
  );
  const tolerance = await getSetting(db, 'finance.po_bill_tolerance_bp');
  return {
    ...o,
    label: label(o.number),
    unbilledPiastres: unbilled,
    maxBillPiastres: unbilled + share(unbilled, tolerance),
    toleranceBp: tolerance,
    bills: o.bills.map((b) => ({ ...b, billDate: b.billDate.toISOString().slice(0, 10) })),
  };
}
