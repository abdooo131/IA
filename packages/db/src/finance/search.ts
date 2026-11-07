import {
  billNumber,
  chequeLabel,
  entryNumber,
  handoverNumber,
  parseDocNumber,
  payoutNumber,
  pettyCashLabel,
  purchaseOrderNumber,
  type SearchHit,
  statementNumber,
  withdrawalNumber,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { invoiceLabel } from './invoices';
import type { ListScope } from './lists';

// The one search of the Accounting app: a document number (JV-, PAY-, CH-, BILL-, INV-, CN-,
// PO-, CHQ-, PC-, RW-, BS-), an order number or a merchant (or supplier) name, each with the
// page it opens. People limited to some stores or merchants find only theirs.

const inStores = (scope: ListScope, storeId: string | null) =>
  !scope.storeIds || !storeId || scope.storeIds.includes(storeId);
const inMerchants = (scope: ListScope, merchantId: string | null) =>
  !scope.merchantIds || !merchantId || scope.merchantIds.includes(merchantId);

async function byNumber(db: Db, text: string, scope: ListScope): Promise<SearchHit | null> {
  const doc = parseDocNumber(text);
  if (!doc) return null;
  const n = doc.number;
  switch (doc.kind) {
    case 'ledger_entry': {
      const e = await db.ledgerEntry.findUnique({ where: { number: n } });
      return (
        e && {
          kind: 'ledger_entry',
          label: entryNumber(n),
          detail: e.memo ?? e.kind,
          href: `/finance/journal/${e.id}`,
        }
      );
    }
    case 'payout': {
      const p = await db.payout.findUnique({
        where: { number: n },
        include: { merchant: { select: { name: true } } },
      });
      return p && inMerchants(scope, p.merchantId)
        ? {
            kind: 'payout',
            label: payoutNumber(n),
            detail: p.merchant.name,
            href: `/finance/payouts/${p.id}`,
          }
        : null;
    }
    case 'cash_handover': {
      const h = await db.cashHandover.findUnique({
        where: { number: n },
        include: { rider: { select: { badgeCode: true } } },
      });
      return h && inStores(scope, h.darkStoreId)
        ? {
            kind: 'cash_handover',
            label: handoverNumber(n),
            detail: h.rider.badgeCode,
            href: '/finance/cash',
          }
        : null;
    }
    case 'bill': {
      const b = await db.bill.findUnique({
        where: { number: n },
        include: { supplier: { select: { name: true } } },
      });
      return b && inStores(scope, b.darkStoreId)
        ? {
            kind: 'bill',
            label: billNumber(n),
            detail: b.supplier.name,
            href: `/finance/bills/${b.id}`,
          }
        : null;
    }
    case 'invoice':
    case 'credit_note': {
      const type = doc.kind === 'invoice' ? 'invoice' : 'credit_note';
      const r = await db.taxInvoice.findUnique({
        where: { type_number: { type, number: n } },
        include: { merchant: { select: { name: true } } },
      });
      return r && inMerchants(scope, r.merchantId)
        ? {
            kind: type,
            label: invoiceLabel(type, n),
            detail: r.merchant.name,
            href: `/finance/invoices/${r.id}`,
          }
        : null;
    }
    case 'purchase_order': {
      const r = await db.purchaseOrder.findUnique({
        where: { number: n },
        include: { supplier: { select: { name: true } } },
      });
      return r && inStores(scope, r.darkStoreId)
        ? {
            kind: 'purchase_order',
            label: purchaseOrderNumber(n),
            detail: r.supplier.name,
            href: `/finance/purchase-orders/${r.id}`,
          }
        : null;
    }
    case 'cheque': {
      const r = await db.cheque.findUnique({ where: { number: n } });
      return r && inMerchants(scope, r.merchantId)
        ? {
            kind: 'cheque',
            label: chequeLabel(n),
            detail: r.partyName,
            href: `/finance/cheques/${r.id}`,
          }
        : null;
    }
    case 'petty_cash': {
      const r = await db.pettyCashExpense.findUnique({
        where: { number: n },
        include: { darkStore: { select: { code: true } } },
      });
      return r && inStores(scope, r.darkStoreId)
        ? {
            kind: 'petty_cash',
            label: pettyCashLabel(n),
            detail: r.darkStore.code,
            href: `/finance/petty-cash/${r.id}`,
          }
        : null;
    }
    case 'rider_withdrawal': {
      const r = await db.riderWithdrawal.findUnique({
        where: { number: n },
        include: { rider: { select: { user: { select: { name: true } } } } },
      });
      return r && inStores(scope, r.darkStoreId)
        ? {
            kind: 'rider_withdrawal',
            label: withdrawalNumber(n),
            detail: r.rider.user.name,
            href: `/finance/rider-withdrawals/${r.id}`,
          }
        : null;
    }
    case 'bank_statement': {
      const r = await db.bankStatement.findUnique({ where: { number: n } });
      return r && !scope.storeIds
        ? {
            kind: 'bank_statement',
            label: statementNumber(n),
            detail: r.fileName,
            href: `/finance/bank?account=${r.accountId}`,
          }
        : null;
    }
    default:
      return null;
  }
}

/** Up to ten things matching the typed text, the exact document first. */
export async function financeSearch(db: Db, text: string, scope: ListScope): Promise<SearchHit[]> {
  const q = text.trim().slice(0, 80);
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  const doc = await byNumber(db, q, scope);
  if (doc) hits.push(doc);

  const orders = await db.order.findMany({
    where: {
      number: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' },
      ...(scope.storeIds && { darkStoreId: { in: scope.storeIds } }),
      ...(scope.merchantIds && { merchantId: { in: scope.merchantIds } }),
    },
    select: { number: true, merchant: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 4,
  });
  for (const o of orders)
    hits.push({
      kind: 'order',
      label: o.number,
      detail: o.merchant.name,
      // The order's money: its entries in the journal.
      href: `/finance/journal?q=${encodeURIComponent(o.number)}&f=`,
    });

  if (!scope.storeIds) {
    const merchants = await db.merchant.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { legalName: { contains: q, mode: 'insensitive' } },
        ],
        ...(scope.merchantIds && { id: { in: scope.merchantIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 4,
    });
    for (const m of merchants)
      hits.push({
        kind: 'merchant',
        label: m.name,
        detail: null,
        href: `/finance/merchants/${m.id}`,
      });
    const suppliers = await db.supplier.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      select: { name: true },
      take: 3,
    });
    for (const s of suppliers)
      hits.push({
        kind: 'supplier',
        label: s.name,
        detail: null,
        href: `/finance/bills?q=${encodeURIComponent(s.name)}&f=`,
      });
  }
  return hits.slice(0, 10);
}
