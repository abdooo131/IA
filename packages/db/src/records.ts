import {
  billNumber,
  cairoDay,
  chequeLabel,
  entryNumber,
  handoverNumber,
  payoutNumber,
  pettyCashLabel,
  purchaseOrderNumber,
  withdrawalNumber,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { invoiceLabel } from './finance/invoices';

// The chatter of a document page (docs/ARCHITECTURE.md "List views and document pages"):
// notes anyone who may use the record writes (append only, audited), and scheduled
// activities ("Remind me") for one person, due on a Cairo day, pushed once when due.

/** What the chatter needs to know about a record: its number, page, store and merchant. */
export interface RecordRef {
  label: string;
  href: string;
  darkStoreId: string | null;
  merchantId: string | null;
  /**
   * A record of several locations (a transfer: sender, receiver, final destination): a person
   * limited to some stores may open it when one of them is theirs. darkStoreId is then null.
   */
  anyStoreIds?: string[];
}

/**
 * Finds a record of a known type. Null when the type has no chatter or the record does not
 * exist (the API answers 404).
 */
export async function recordRef(db: Db, entityType: string, id: string): Promise<RecordRef | null> {
  switch (entityType) {
    case 'payout': {
      const r = await db.payout.findUnique({ where: { id } });
      return (
        r && {
          label: payoutNumber(r.number),
          href: `/finance/payouts/${id}`,
          darkStoreId: null,
          merchantId: r.merchantId,
        }
      );
    }
    case 'bill': {
      const r = await db.bill.findUnique({ where: { id } });
      return (
        r && {
          label: billNumber(r.number),
          href: `/finance/bills/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    case 'ledger_entry': {
      const r = await db.ledgerEntry.findUnique({ where: { id } });
      return (
        r && {
          label: entryNumber(r.number),
          href: `/finance/journal/${id}`,
          darkStoreId: null,
          merchantId: null,
        }
      );
    }
    case 'cheque': {
      const r = await db.cheque.findUnique({ where: { id } });
      return (
        r && {
          label: chequeLabel(r.number),
          href: `/finance/cheques/${id}`,
          darkStoreId: null,
          merchantId: r.merchantId,
        }
      );
    }
    case 'rider_withdrawal': {
      const r = await db.riderWithdrawal.findUnique({ where: { id } });
      return (
        r && {
          label: withdrawalNumber(r.number),
          href: `/finance/rider-withdrawals/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    case 'finance_request': {
      const r = await db.financeRequest.findUnique({ where: { id } });
      if (!r) return null;
      const input = (r.payload as { input?: { darkStoreId?: string } } | null)?.input;
      return {
        label: `${r.kind} ${r.id.slice(-6)}`,
        href: `/finance/approvals/${id}`,
        darkStoreId: input?.darkStoreId ?? null,
        merchantId: null,
      };
    }
    case 'petty_cash': {
      const r = await db.pettyCashExpense.findUnique({ where: { id } });
      return (
        r && {
          label: pettyCashLabel(r.number),
          href: `/finance/petty-cash/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    case 'tax_invoice': {
      const r = await db.taxInvoice.findUnique({ where: { id } });
      return (
        r && {
          label: invoiceLabel(r.type, r.number),
          href: `/finance/invoices/${id}`,
          darkStoreId: null,
          merchantId: r.merchantId,
        }
      );
    }
    case 'purchase_order': {
      const r = await db.purchaseOrder.findUnique({ where: { id } });
      return (
        r && {
          label: purchaseOrderNumber(r.number),
          href: `/finance/purchase-orders/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    case 'cash_handover': {
      const r = await db.cashHandover.findUnique({ where: { id } });
      return (
        r && {
          label: handoverNumber(r.number),
          href: `/finance/cash`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    // UX phase C step 1: the Operations documents.
    case 'order': {
      const r = await db.order.findUnique({
        where: { id },
        select: { number: true, darkStoreId: true, merchantId: true },
      });
      return (
        r && {
          label: r.number,
          href: `/admin/orders/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: r.merchantId,
        }
      );
    }
    case 'alert': {
      const r = await db.alert.findUnique({
        where: { id },
        select: {
          type: true,
          darkStoreId: true,
          merchantId: true,
          order: { select: { merchantId: true } },
        },
      });
      return (
        r && {
          label: r.type,
          href: '/admin/alerts',
          darkStoreId: r.darkStoreId,
          merchantId: r.merchantId ?? r.order?.merchantId ?? null,
        }
      );
    }
    case 'damage_report': {
      const r = await db.damageReport.findUnique({
        where: { id },
        select: { darkStoreId: true, merchantId: true, sku: { select: { sku: true } } },
      });
      return (
        r && {
          label: r.sku.sku,
          href: `/admin/damage/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: r.merchantId,
        }
      );
    }
    // UX phase C step 2: the Inventory documents.
    case 'inbound_manifest': {
      const r = await db.inboundManifest.findUnique({
        where: { id },
        select: { reference: true, darkStoreId: true, merchantId: true },
      });
      return (
        r && {
          label: r.reference,
          href: `/admin/shipments/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: r.merchantId,
        }
      );
    }
    case 'transfer': {
      const r = await db.transfer.findUnique({
        where: { id },
        select: { reference: true, fromId: true, toId: true, finalDestinationId: true },
      });
      return (
        r && {
          label: r.reference,
          href: `/admin/transfers/${id}`,
          darkStoreId: null,
          merchantId: null,
          anyStoreIds: [r.fromId, r.toId, r.finalDestinationId].filter((x): x is string => !!x),
        }
      );
    }
    case 'merchant_return': {
      const r = await db.merchantReturn.findUnique({
        where: { id },
        select: { reference: true, darkStoreId: true, merchantId: true },
      });
      return (
        r && {
          label: r.reference,
          href: `/admin/returns/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: r.merchantId,
        }
      );
    }
    case 'stock_count': {
      const r = await db.stockCount.findUnique({
        where: { id },
        select: {
          darkStoreId: true,
          darkStore: { select: { code: true } },
          bin: { select: { code: true } },
        },
      });
      return (
        r && {
          label: `${r.darkStore.code} · ${r.bin.code}`,
          href: `/admin/counts/${id}`,
          darkStoreId: r.darkStoreId,
          merchantId: null,
        }
      );
    }
    // UX phase C step 3: merchants, their products and customer profiles.
    case 'merchant': {
      const r = await db.merchant.findUnique({ where: { id }, select: { name: true } });
      return (
        r && { label: r.name, href: `/admin/merchants/${id}`, darkStoreId: null, merchantId: id }
      );
    }
    case 'sku': {
      const r = await db.sku.findUnique({
        where: { id },
        select: { sku: true, merchantId: true },
      });
      return (
        r && {
          label: r.sku,
          href: `/admin/products/${id}`,
          darkStoreId: null,
          merchantId: r.merchantId,
        }
      );
    }
    case 'customer': {
      // A neutral label: reminders and their push notices never carry a customer's name.
      const r = await db.customer.findUnique({ where: { id }, select: { id: true } });
      return (
        r && {
          label: `CUS-${id.slice(-6).toUpperCase()}`,
          href: `/admin/customers/${id}`,
          darkStoreId: null,
          merchantId: null,
        }
      );
    }
    default:
      return null;
  }
}

// ─── notes ──────────────────────────────────────────────────────────────────────

export async function listRecordNotes(db: Db, entityType: string, entityId: string) {
  const rows = await db.recordNote.findMany({
    where: { entityType, entityId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((n) => ({ id: n.id, at: n.createdAt, author: n.author, body: n.body }));
}

/** Adds a note (never changed or deleted afterwards), audited on the record. */
export function addRecordNote(
  db: Db,
  input: { entityType: string; entityId: string; body: string; actorUserId: string },
) {
  const body = input.body.trim();
  if (!body) throw new DomainError('note_required', 400);
  return inTransaction(db, async (tx) => {
    const note = await tx.recordNote.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        authorId: input.actorUserId,
        body,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'record.note',
      entityType: input.entityType,
      entityId: input.entityId,
      after: { noteId: note.id, length: body.length },
    });
    return { id: note.id, at: note.createdAt };
  });
}

// ─── activities ─────────────────────────────────────────────────────────────────

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOfDate = (d: Date) => d.toISOString().slice(0, 10);

function activityView(a: {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  href: string;
  dueOn: Date;
  note: string;
  doneAt: Date | null;
  createdAt: Date;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string };
}) {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    label: a.label,
    href: a.href,
    dueOn: dayOfDate(a.dueOn),
    note: a.note,
    doneAt: a.doneAt,
    createdAt: a.createdAt,
    assignee: a.assignee,
    createdBy: a.createdBy,
  };
}

const people = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

export async function listRecordActivities(db: Db, entityType: string, entityId: string) {
  const rows = await db.recordActivity.findMany({
    where: { entityType, entityId },
    include: people,
    orderBy: [{ doneAt: { sort: 'desc', nulls: 'first' } }, { dueOn: 'asc' }],
    take: 100,
  });
  return rows.map(activityView);
}

/** Schedules a reminder on a record for one person (the writer by default). */
export async function scheduleActivity(
  db: Db,
  input: {
    entityType: string;
    entityId: string;
    ref: RecordRef;
    dueOn: string;
    note: string;
    assigneeId?: string;
    actorUserId: string;
  },
) {
  const assigneeId = input.assigneeId ?? input.actorUserId;
  const assignee = await db.user.findUnique({ where: { id: assigneeId } });
  if (!assignee || !assignee.isActive || assignee.role === 'merchant' || assignee.role === 'rider')
    throw new DomainError('assignee_not_found', 400);
  return inTransaction(db, async (tx) => {
    const a = await tx.recordActivity.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        label: input.ref.label,
        href: input.ref.href,
        assigneeId,
        createdById: input.actorUserId,
        dueOn: dateOf(input.dueOn),
        note: input.note.trim(),
      },
      include: people,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'record.activity',
      entityType: input.entityType,
      entityId: input.entityId,
      after: { activityId: a.id, assigneeId, dueOn: input.dueOn },
    });
    return activityView(a);
  });
}

/** Marks a reminder done: the person reminded or whoever scheduled it. */
export function completeRecordActivity(db: Db, input: { activityId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const a = await tx.recordActivity.findUnique({ where: { id: input.activityId } });
    if (!a) throw new DomainError('activity_not_found', 404);
    if (a.assigneeId !== input.actorUserId && a.createdById !== input.actorUserId)
      throw new DomainError('not_your_activity', 403);
    if (a.doneAt) return { done: true };
    await tx.recordActivity.update({
      where: { id: a.id },
      data: { doneAt: new Date(), doneById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'record.activity_done',
      entityType: a.entityType,
      entityId: a.entityId,
      after: { activityId: a.id },
    });
    return { done: true };
  });
}

/** A person's open reminders, due ones first (dueBy: only those due by that Cairo day). */
export async function myActivities(
  db: Db,
  userId: string,
  options: { dueBy?: string; entityTypes?: string[] } = {},
) {
  const rows = await db.recordActivity.findMany({
    where: {
      assigneeId: userId,
      doneAt: null,
      ...(options.dueBy && { dueOn: { lte: dateOf(options.dueBy) } }),
      ...(options.entityTypes && { entityType: { in: options.entityTypes } }),
    },
    include: people,
    orderBy: { dueOn: 'asc' },
    take: 100,
  });
  return rows.map(activityView);
}

/** Open reminders due today or yesterday (Cairo) that the push dispatcher considers. */
export function dueActivities(db: Db, now: Date) {
  const today = cairoDay(now);
  const yesterday = new Date(dateOf(today).getTime() - 86_400_000);
  return db.recordActivity.findMany({
    where: { doneAt: null, dueOn: { lte: dateOf(today), gte: yesterday } },
    select: { id: true, assigneeId: true, label: true, href: true, note: true },
    take: 500,
  });
}
