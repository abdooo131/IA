import { addDays, cairoDay } from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { payoutDueOn } from './finance/operations';

// What the order page shows besides the order itself: the notes threads and the money of the
// order as the ledger booked it (docs: CLAUDE.md "Order page").

export const ORDER_NOTE_AUDIENCES = ['team', 'merchant'] as const;
export type OrderNoteAudience = (typeof ORDER_NOTE_AUDIENCES)[number];

export interface OrderNoteView {
  id: string;
  audience: OrderNoteAudience;
  body: string;
  at: Date;
  author: string;
  /** The author is one of the merchant's users (not our team) */
  fromMerchant: boolean;
}

/** The notes of an order the viewer may read, oldest first. */
export async function listOrderNotes(
  db: Db,
  orderId: string,
  audiences: readonly OrderNoteAudience[],
): Promise<OrderNoteView[]> {
  const rows = await db.orderNote.findMany({
    where: { orderId, audience: { in: [...audiences] } },
    include: { author: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((n) => ({
    id: n.id,
    audience: n.audience as OrderNoteAudience,
    body: n.body,
    at: n.createdAt,
    author: n.author.name,
    fromMerchant: n.author.role === 'merchant',
  }));
}

/** Adds a note to one of the order's threads (append only, audited). */
export function addOrderNote(
  db: Db,
  input: { orderId: string; audience: OrderNoteAudience; body: string; authorUserId: string },
) {
  const body = input.body.trim();
  if (!body || body.length > 1000) throw new DomainError('invalid_note', 400);
  return inTransaction(db, async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true } });
    if (!order) throw new DomainError('order_not_found', 404);
    const note = await tx.orderNote.create({
      data: {
        orderId: order.id,
        audience: input.audience,
        body,
        authorId: input.authorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.authorUserId,
      action: 'order.note',
      entityType: 'order',
      entityId: order.id,
      after: { audience: input.audience, noteId: note.id },
    });
    return { id: note.id };
  });
}

export type OrderFeeKind = 'order_fixed' | 'order_percent' | 'cod_fee' | 'failed_fee' | 'other';

export interface OrderMoney {
  paymentMethod: 'cod' | 'prepaid';
  /** Value of the products still on the order (cancelled units left out) */
  productValuePiastres: number;
  codAmountPiastres: number;
  /** Cash the rider collected and the merchant was credited with, once delivered */
  codCreditedPiastres: number | null;
  fees: { kind: OrderFeeKind; amountPiastres: number; percentBp: number | null }[];
  vatPiastres: number;
  /** Fees plus VAT charged to the merchant for this order */
  duesPiastres: number;
  /** What this order adds to the merchant's wallet (cash credited minus dues) */
  netPiastres: number;
  /** Where the money of this order stands; null while nothing is booked yet */
  payout:
    | { status: 'paid'; number: number; reference: string | null; paidAt: Date | null }
    | { status: 'draft'; number: number }
    | { status: 'next'; day: string }
    | null;
}

/**
 * The order's money from its ledger postings: the cash credited to the merchant, each fee
 * with its VAT, the dues and where the merchant's money stands (paid in a payout, in a draft
 * payout, or the next payout day of the merchant's schedule).
 */
export async function getOrderMoney(
  db: Db,
  orderId: string,
  now = new Date(),
): Promise<OrderMoney> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      merchant: { select: { id: true, payoutSchedule: true } },
      ledgerEntries: {
        include: { lines: { include: { account: { select: { type: true, merchantId: true } } } } },
        orderBy: { occurredAt: 'asc' },
      },
    },
  });
  if (!order) throw new DomainError('order_not_found', 404);
  const merchantId = order.merchantId;

  let codCredited: number | null = null;
  let vat = 0;
  const fees: OrderMoney['fees'] = [];
  let lastAt: Date | null = null;
  for (const entry of order.ledgerEntries) {
    const onMerchant = entry.lines
      .filter((l) => l.account.type === 'merchant' && l.account.merchantId === merchantId)
      .reduce((s, l) => s + l.amountPiastres, 0);
    if (onMerchant === 0) continue;
    lastAt = entry.occurredAt;
    if (entry.kind === 'cod_collected') {
      codCredited = (codCredited ?? 0) - onMerchant;
      continue;
    }
    const entryVat = -entry.lines
      .filter((l) => l.account.type === 'vat_payable')
      .reduce((s, l) => s + l.amountPiastres, 0);
    const fee = onMerchant - entryVat;
    vat += entryVat;
    const data = (entry.data ?? {}) as Record<string, unknown>;
    if (entry.kind === 'order_fee') {
      const fixed = Math.min(fee, Number(data.fixedPiastres ?? 0));
      fees.push({ kind: 'order_fixed', amountPiastres: fixed, percentBp: null });
      fees.push({
        kind: 'order_percent',
        amountPiastres: fee - fixed,
        percentBp: typeof data.percentBp === 'number' ? data.percentBp : null,
      });
    } else if (entry.kind === 'cod_fee' || entry.kind === 'failed_fee') {
      fees.push({
        kind: entry.kind,
        amountPiastres: fee,
        percentBp: typeof data.percentBp === 'number' ? data.percentBp : null,
      });
    } else {
      fees.push({ kind: 'other', amountPiastres: fee, percentBp: null });
    }
  }
  const dues = fees.reduce((s, f) => s + f.amountPiastres, 0) + vat;

  let payout: OrderMoney['payout'] = null;
  if (lastAt) {
    const covering = await db.payout.findFirst({
      where: { merchantId, status: { in: ['paid', 'draft'] }, cutoffAt: { gte: lastAt } },
      orderBy: { cutoffAt: 'asc' },
    });
    if (covering?.status === 'paid')
      payout = {
        status: 'paid',
        number: covering.number,
        reference: covering.reference,
        paidAt: covering.paidAt,
      };
    else if (covering) payout = { status: 'draft', number: covering.number };
    else {
      // Payouts cover whole Cairo days, so the earliest is the day after the booking.
      const after = cairoDay(lastAt);
      const today = cairoDay(now);
      let day = addDays(after > today ? after : today, after >= today ? 1 : 0);
      for (let i = 0; i < 7; i++) {
        if (payoutDueOn(order.merchant.payoutSchedule, new Date(`${day}T12:00:00Z`).getUTCDay()))
          break;
        day = addDays(day, 1);
      }
      payout = { status: 'next', day };
    }
  }

  return {
    paymentMethod: order.paymentMethod,
    productValuePiastres: order.items.reduce(
      (s, i) => s + (i.quantity - i.cancelledQty) * i.unitPricePiastres,
      0,
    ),
    codAmountPiastres: order.codAmountPiastres,
    codCreditedPiastres: codCredited,
    fees,
    vatPiastres: vat,
    duesPiastres: dues,
    netPiastres: (codCredited ?? 0) - dues,
    payout,
  };
}
