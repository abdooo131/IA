import {
  type AccountingDoc,
  basataDepositNumber,
  basataSettlementNumber,
  billNumber,
  cairoDay,
  chequeLabel,
  egpText,
  type DocDescriptor,
  type DocField,
  type DocSmartButton,
  entryNumber,
  expenseClaimNumber,
  handoverNumber,
  payoutMatches,
  payoutNumber,
  pettyCashLabel,
  proofNumber,
  soaNumber,
  purchaseOrderNumber,
  withdrawalNumber,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { getSetting } from '../settings';
import { invoiceLabel } from './invoices';
import { pettyStatusOf } from './cash-control';
import { attachmentsFor, photoAttachment } from './attachments';

// Document pages (Odoo form views): one descriptor per accounting document with its fields,
// lines, smart buttons (counts linking to related records) and attachments. The web renders
// every kind with DocumentPage; the actions themselves stay the existing finance endpoints.

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dbDay = (d: Date) => d.toISOString().slice(0, 10);
const f = (key: string, value: DocField['value'], kind: DocField['kind'] = 'text', href?: string) =>
  ({ key, value, kind, ...(href ? { href } : {}) }) satisfies DocField;
/** Fields without a value are left out. */
const present = (fields: DocField[]) =>
  fields.filter((x) => x.value !== null && x.value !== undefined && x.value !== '');
const journalHref = (entryIds: string[], q: string) =>
  entryIds.length === 1
    ? `/finance/journal/${entryIds[0]}`
    : `/finance/journal?q=${encodeURIComponent(q)}&f=`;

/** The files of entries, a payout or a request (also through requests and payouts). */
function receipts(
  db: Db,
  where: { entryId?: { in: string[] }; payoutId?: string; requestId?: string },
) {
  return attachmentsFor(db, {
    entryIds: where.entryId?.in ?? [],
    payoutIds: where.payoutId ? [where.payoutId] : [],
    requestIds: where.requestId ? [where.requestId] : [],
  });
}

const base = (
  type: AccountingDoc,
  id: string,
  rest: Partial<DocDescriptor> & Pick<DocDescriptor, 'number' | 'title' | 'status' | 'fields'>,
): DocDescriptor => ({
  type,
  id,
  flow: null,
  entityType: type,
  lines: null,
  smart: [],
  attachments: [],
  actions: [],
  data: {},
  ...rest,
});

// ─── payout ─────────────────────────────────────────────────────────────────────

async function payoutDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const p = await db.payout.findUnique({
    where: { id },
    include: {
      merchant: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      paidBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      statement: { select: { number: true, netPiastres: true } },
      proof: { select: { number: true, amountPiastres: true, reference: true } },
      _count: { select: { cheques: true } },
    },
  });
  if (!p) return null;
  const number = payoutNumber(p.number);
  const activeChecks = await db.payoutCheck.count({ where: { active: true } });
  const ticked = await db.payoutCheckMark.count({
    where: { payoutId: p.id, check: { active: true } },
  });
  const [entries, emails, files, limit] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { idempotencyKey: { startsWith: `payout:${p.id}` } },
      select: { id: true },
    }),
    db.emailOutbox.count({ where: { idempotencyKey: { contains: p.id } } }),
    receipts(db, { payoutId: p.id }),
    getSetting(db, 'finance.approval_threshold_piastres'),
  ]);
  const smart: DocSmartButton[] = [
    {
      key: 'merchant',
      count: null,
      value: p.merchant.name,
      href: `/finance/merchants/${p.merchantId}`,
    },
    {
      key: 'entries',
      count: entries.length,
      href: journalHref(
        entries.map((e) => e.id),
        number,
      ),
    },
    { key: 'receipts', count: files.length, href: '#attachments' },
    { key: 'emails', count: emails, href: `/finance/emails?merchantId=${p.merchantId}` },
  ];
  if (p.statement)
    smart.push({
      key: 'statement',
      count: null,
      value: soaNumber(p.statement.number),
      href: '#payout-controls',
    });
  smart.push({
    key: 'proof',
    count: p.proof ? null : 0,
    value: p.proof ? proofNumber(p.proof.number) : undefined,
    href: '#payout-controls',
  });
  if (p._count.cheques)
    smart.push({
      key: 'cheques',
      count: p._count.cheques,
      href: `/finance/cheques?q=${number}&f=`,
    });
  return base('payout', p.id, {
    number,
    title: p.merchant.name,
    status: p.status,
    flow: 'payout',
    fields: present([
      f('merchant', p.merchant.name, 'text', `/finance/merchants/${p.merchantId}`),
      f('amount', p.amountPiastres, 'money'),
      f('cutoff', cairoDay(new Date(p.cutoffAt.getTime() - 1)), 'date'),
      f('createdBy', p.createdBy.name),
      f('createdAt', iso(p.createdAt), 'datetime'),
      f('approvedBy', p.approvedBy?.name ?? null),
      f('paidBy', p.paidBy?.name ?? null),
      f('paidAt', iso(p.paidAt), 'datetime'),
      f('reference', p.reference, 'ltr'),
      f('statement', p.statement ? soaNumber(p.statement.number) : null, 'ltr'),
      f('proof', p.proof ? proofNumber(p.proof.number) : null, 'ltr'),
      f('proofReference', p.proof?.reference ?? null, 'ltr'),
      f('note', p.note, 'multiline'),
    ]),
    smart,
    attachments: files,
    attachTarget: { payoutId: p.id },
    data: {
      merchantId: p.merchantId,
      amountPiastres: p.amountPiastres,
      createdById: p.createdById,
      needsApproval:
        p.status === 'draft' && limit > 0 && p.amountPiastres >= limit && !p.approvedById,
      hasStatement: !!p.statement,
      hasProof: !!p.proof,
      checksDone: ticked >= activeChecks,
      matches: payoutMatches({
        amountPiastres: p.amountPiastres,
        soaNetPiastres: p.statement?.netPiastres ?? null,
        potAmountPiastres: p.proof?.amountPiastres ?? null,
      }),
    },
  });
}

// ─── bill ───────────────────────────────────────────────────────────────────────

async function billDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const b = await db.bill.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      expenseAccount: { select: { code: true, nameEn: true } },
      darkStore: { select: { code: true } },
      purchaseOrder: { select: { id: true, number: true } },
      person: { select: { name: true } },
      _count: { select: { cheques: true } },
    },
  });
  if (!b) return null;
  const number = billNumber(b.number);
  const payments = await db.ledgerEntry.findMany({
    where: { kind: 'bill_payment', data: { path: ['billId'], equals: b.id } },
    select: { id: true, number: true, occurredAt: true, data: true },
    orderBy: { occurredAt: 'asc' },
  });
  const cancel = await db.ledgerEntry.findUnique({
    where: { idempotencyKey: `bill_cancel:${b.id}` },
    select: { id: true },
  });
  const entryIds = [b.entryId, ...payments.map((p) => p.id), cancel?.id].filter(
    (x): x is string => !!x,
  );
  const files = await receipts(db, { entryId: { in: entryIds } });
  const smart: DocSmartButton[] = [
    {
      key: 'supplier',
      count: null,
      value: b.supplier.name,
      href: `/finance/bills?q=${encodeURIComponent(b.supplier.name)}&f=`,
    },
    {
      key: 'payments',
      count: payments.length,
      href: journalHref(
        payments.map((p) => p.id),
        b.reference,
      ),
    },
    { key: 'entries', count: entryIds.length, href: journalHref(entryIds, number) },
    { key: 'attachments', count: files.length, href: '#attachments' },
  ];
  if (b.purchaseOrder)
    smart.push({
      key: 'purchaseOrder',
      count: null,
      value: purchaseOrderNumber(b.purchaseOrder.number),
      href: `/finance/purchase-orders/${b.purchaseOrder.id}`,
    });
  if (b._count.cheques)
    smart.push({
      key: 'cheques',
      count: b._count.cheques,
      href: `/finance/cheques?q=${encodeURIComponent(b.supplier.name)}&f=`,
    });
  if (b.officeMonth)
    smart.push({
      key: 'riderOffice',
      count: null,
      value: b.supplier.name,
      href: `/finance/rider-offices/${b.supplierId}`,
    });
  return base('bill', b.id, {
    number,
    title: b.supplier.name,
    status: b.status,
    flow: 'bill',
    fields: present([
      f('supplier', b.supplier.name),
      f('supplierReference', b.reference, 'ltr'),
      f('billDate', dbDay(b.billDate), 'date'),
      f('dueDate', dbDay(b.dueDate), 'date'),
      f('account', `${b.expenseAccount.code} ${b.expenseAccount.nameEn}`),
      f('store', b.darkStore?.code ?? null),
      f('person', b.person?.name ?? null),
      f('officeMonth', b.officeMonth, 'ltr'),
      f('net', b.netPiastres, 'money'),
      f('vat', b.vatPiastres, 'money'),
      f('total', b.totalPiastres, 'money'),
      f('paid', b.paidPiastres, 'money'),
      f('left', b.status === 'open' ? b.totalPiastres - b.paidPiastres : 0, 'money'),
      f('withholding', b.whtBp ? b.whtBp / 100 : null, 'percent'),
      f('currency', b.currency === 'EGP' ? null : b.currency, 'ltr'),
      f('memo', b.memo, 'multiline'),
    ]),
    lines: payments.length
      ? {
          columns: [
            { key: 'entry', kind: 'ltr' },
            { key: 'day', kind: 'date' },
            { key: 'amount', kind: 'money' },
          ],
          rows: payments.map((p) => ({
            id: p.id,
            entry: entryNumber(p.number),
            day: cairoDay(p.occurredAt),
            amount: Number((p.data as { gross?: number } | null)?.gross ?? 0),
          })),
        }
      : null,
    smart,
    attachments: files,
    attachTarget: b.entryId ? { entryId: b.entryId } : null,
    data: { supplierId: b.supplierId, darkStoreId: b.darkStoreId },
  });
}

// ─── ledger entry ───────────────────────────────────────────────────────────────

/** The document an entry was posted for, from its idempotency key or its links. */
async function sourceOf(db: Db, e: { id: string; idempotencyKey: string; orderId: string | null }) {
  const [prefix, rest] = [e.idempotencyKey.split(':')[0], e.idempotencyKey.split(':')[1] ?? ''];
  if (prefix === 'payout') {
    const p = await db.payout.findUnique({
      where: { id: rest },
      select: { id: true, number: true },
    });
    if (p) return { value: payoutNumber(p.number), href: `/finance/payouts/${p.id}` };
  }
  if (prefix === 'petty' || prefix === 'petty_reversal') {
    const p = await db.pettyCashExpense.findUnique({
      where: { id: rest },
      select: { id: true, number: true },
    });
    if (p) return { value: pettyCashLabel(p.number), href: `/finance/petty-cash/${p.id}` };
  }
  if (prefix === 'rider_withdrawal') {
    const w = await db.riderWithdrawal.findUnique({
      where: { id: rest },
      select: { id: true, number: true },
    });
    if (w) return { value: withdrawalNumber(w.number), href: `/finance/rider-withdrawals/${w.id}` };
  }
  if (prefix === 'expense_claim') {
    const c = await db.expenseClaim.findUnique({
      where: { id: rest },
      select: { id: true, number: true },
    });
    if (c) return { value: expenseClaimNumber(c.number), href: `/finance/expense-claims/${c.id}` };
  }
  if (prefix === 'handover') {
    const h = await db.cashHandover.findUnique({ where: { id: rest }, select: { number: true } });
    if (h) return { value: handoverNumber(h.number), href: '/finance/cash' };
  }
  const [bill, invoice, cheque, request] = await Promise.all([
    db.bill.findFirst({
      where: { OR: [{ entryId: e.id }, { id: prefix === 'bill_cancel' ? rest : '-' }] },
      select: { id: true, number: true },
    }),
    db.taxInvoice.findFirst({
      where: { entryId: e.id },
      select: { id: true, type: true, number: true },
    }),
    db.cheque.findFirst({
      where: { OR: [{ bookEntryId: e.id }, { clearEntryId: e.id }, { reverseEntryId: e.id }] },
      select: { id: true, number: true },
    }),
    db.financeRequest.findFirst({ where: { entryId: e.id }, select: { id: true, kind: true } }),
  ]);
  if (bill) return { value: billNumber(bill.number), href: `/finance/bills/${bill.id}` };
  if (invoice)
    return {
      value: invoiceLabel(invoice.type, invoice.number),
      href: `/finance/invoices/${invoice.id}`,
    };
  if (cheque) return { value: chequeLabel(cheque.number), href: `/finance/cheques/${cheque.id}` };
  if (request) return { value: request.kind, href: `/finance/approvals/${request.id}` };
  return null;
}

/** The name an account shows: its own, else its owner's (a merchant's or rider's wallet). */
function accountName(
  a: {
    nameEn: string | null;
    nameAr: string | null;
    merchant: { name: string } | null;
    rider: { badgeCode: string; user: { name: string } } | null;
    darkStore: { code: string; nameEn: string; nameAr: string } | null;
    user: { name: string } | null;
    supplier: { name: string } | null;
  },
  lang: 'en' | 'ar',
) {
  const own = lang === 'ar' ? (a.nameAr ?? a.nameEn) : (a.nameEn ?? a.nameAr);
  if (own) return own;
  if (a.merchant) return a.merchant.name;
  if (a.rider) return `${a.rider.user.name} (${a.rider.badgeCode})`;
  if (a.darkStore) return lang === 'ar' ? a.darkStore.nameAr : a.darkStore.nameEn;
  if (a.supplier) return a.supplier.name;
  if (a.user) return a.user.name;
  return '';
}

const accountOwner = {
  select: {
    nameEn: true,
    nameAr: true,
    code: true,
    merchant: { select: { name: true } },
    rider: { select: { badgeCode: true, user: { select: { name: true } } } },
    darkStore: { select: { code: true, nameEn: true, nameAr: true } },
    user: { select: { name: true } },
    supplier: { select: { name: true } },
  },
} as const;

async function entryDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const e = await db.ledgerEntry.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      order: { select: { id: true, number: true } },
      requests: {
        select: {
          id: true,
          requestedBy: { select: { name: true } },
          decidedBy: { select: { name: true } },
          decidedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      lines: {
        include: {
          account: accountOwner,
          darkStore: { select: { code: true } },
          merchant: { select: { name: true } },
          rider: { select: { badgeCode: true, user: { select: { name: true } } } },
        },
        orderBy: { amountPiastres: 'desc' },
      },
    },
  });
  if (!e) return null;
  const number = entryNumber(e.number);
  const [files, source, company] = await Promise.all([
    receipts(db, { entryId: { in: [e.id] } }),
    sourceOf(db, e),
    db.companyProfile.findUnique({
      where: { id: 'company' },
      select: { legalNameEn: true, legalNameAr: true, taxRegistrationNumber: true },
    }),
  ]);
  const request = e.requests[0] ?? null;
  const reference = (e.data as { reference?: unknown } | null)?.reference;
  const smart: DocSmartButton[] = [
    { key: 'lines', count: e.lines.length, href: '#lines' },
    { key: 'receipts', count: files.length, href: '#attachments' },
  ];
  if (source) smart.push({ key: 'source', count: null, value: source.value, href: source.href });
  if (request)
    smart.push({
      key: 'request',
      count: null,
      value: request.decidedBy?.name ?? request.requestedBy.name,
      href: `/finance/approvals/${request.id}`,
    });
  if (e.order)
    smart.push({
      key: 'order',
      count: null,
      value: e.order.number,
      href: `/admin/orders/${e.order.id}`,
    });
  const total = e.lines.reduce((s, l) => s + Math.max(l.amountPiastres, 0), 0);
  // Who made it: the person who asked when it went through a second person, else the poster.
  const madeBy = request?.requestedBy.name ?? e.createdBy?.name ?? null;
  const approvedBy = request?.decidedBy?.name ?? null;
  return base('ledger_entry', e.id, {
    number,
    title: e.memo ?? e.kind,
    status: 'posted',
    fields: present([
      f('kind', e.kind),
      f('day', cairoDay(e.occurredAt), 'date'),
      f('memo', e.memo, 'multiline'),
      f('reference', typeof reference === 'string' ? reference : null, 'ltr'),
      f('source', source?.value ?? null, 'ltr', source?.href),
      f(
        'order',
        e.order?.number ?? null,
        'ltr',
        e.order ? `/admin/orders/${e.order.id}` : undefined,
      ),
      f('createdBy', madeBy),
      f('createdAt', iso(e.createdAt), 'datetime'),
      f('approvedBy', approvedBy),
      f('approvedAt', iso(request?.decidedAt), 'datetime'),
      f('amount', total, 'money'),
    ]),
    lines: {
      columns: [
        { key: 'account', kind: 'text' },
        { key: 'store', kind: 'ltr' },
        { key: 'merchant', kind: 'text' },
        { key: 'rider', kind: 'text' },
        { key: 'debit', kind: 'money' },
        { key: 'credit', kind: 'money' },
      ],
      rows: e.lines.map((l) => ({
        id: l.id,
        account: `${l.account.code} ${accountName(l.account, 'en')}`.trim(),
        accountAr: `${l.account.code} ${accountName(l.account, 'ar')}`.trim(),
        store: l.darkStore?.code ?? null,
        merchant: l.merchant?.name ?? null,
        rider: l.rider ? `${l.rider.user.name} (${l.rider.badgeCode})` : null,
        debit: l.amountPiastres > 0 ? l.amountPiastres : null,
        credit: l.amountPiastres < 0 ? -l.amountPiastres : null,
      })),
    },
    smart,
    attachments: files,
    attachTarget: { entryId: e.id },
    data: {
      companyNameEn: company?.legalNameEn || null,
      companyNameAr: company?.legalNameAr || null,
      companyTaxNumber: company?.taxRegistrationNumber || null,
      madeBy,
      approvedBy,
      sourceLabel: source?.value ?? null,
    },
  });
}

// ─── cheque ─────────────────────────────────────────────────────────────────────

async function chequeDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const c = await db.cheque.findUnique({
    where: { id },
    include: {
      merchant: { select: { id: true, name: true } },
      bill: { select: { id: true, number: true } },
      payout: { select: { id: true, number: true } },
    },
  });
  if (!c) return null;
  const entryIds = [c.bookEntryId, c.clearEntryId, c.reverseEntryId].filter(
    (x): x is string => !!x,
  );
  const number = chequeLabel(c.number);
  const [requests, own] = await Promise.all([
    db.financeRequest.findMany({
      where: { payload: { path: ['input', 'chequeId'], equals: c.id } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    }),
    c.photoId ? photoAttachment(db, c.photoId, c.createdAt, null) : null,
  ]);
  const linked = await attachmentsFor(db, { entryIds, requestIds: requests.map((r) => r.id) });
  const files = [...(own ? [own] : []), ...linked.filter((a) => a.photoId !== c.photoId)];
  const smart: DocSmartButton[] = [
    { key: 'entries', count: entryIds.length, href: journalHref(entryIds, number) },
  ];
  if (c.merchant)
    smart.unshift({
      key: 'merchant',
      count: null,
      value: c.merchant.name,
      href: `/finance/merchants/${c.merchant.id}`,
    });
  if (c.bill)
    smart.push({
      key: 'bill',
      count: null,
      value: billNumber(c.bill.number),
      href: `/finance/bills/${c.bill.id}`,
    });
  if (c.payout)
    smart.push({
      key: 'payout',
      count: null,
      value: payoutNumber(c.payout.number),
      href: `/finance/payouts/${c.payout.id}`,
    });
  return base('cheque', c.id, {
    number,
    title: c.partyName,
    status: c.status,
    flow: c.direction === 'received' ? 'cheque_received' : 'cheque_issued',
    fields: present([
      f('party', c.partyName),
      f('amount', c.amountPiastres, 'money'),
      f('dueDate', dbDay(c.dueDate), 'date'),
    ]),
    smart,
    attachments: files,
    attachTarget: c.bookEntryId
      ? { entryId: c.bookEntryId }
      : requests[0]
        ? { requestId: requests[0].id }
        : null,
    data: { merchantId: c.merchantId },
  });
}

// ─── rider withdrawal ───────────────────────────────────────────────────────────

async function withdrawalDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const w = await db.riderWithdrawal.findUnique({
    where: { id },
    include: {
      rider: { select: { id: true, badgeCode: true, user: { select: { name: true } } } },
      darkStore: { select: { id: true, code: true } },
      approvedBy: { select: { name: true } },
      paidBy: { select: { name: true } },
      rejectedBy: { select: { name: true } },
    },
  });
  if (!w) return null;
  const files = w.entryId ? await receipts(db, { entryId: { in: [w.entryId] } }) : [];
  const smart: DocSmartButton[] = [
    {
      key: 'rider',
      count: null,
      value: `${w.rider.user.name} (${w.rider.badgeCode})`,
      href: `/finance/riders?q=${encodeURIComponent(w.rider.badgeCode)}`,
    },
    {
      key: 'entries',
      count: w.entryId ? 1 : 0,
      href: w.entryId ? `/finance/journal/${w.entryId}` : '#',
    },
    { key: 'receipts', count: files.length, href: '#attachments' },
  ];
  return base('rider_withdrawal', w.id, {
    number: withdrawalNumber(w.number),
    title: w.rider.user.name,
    status: w.status,
    flow: 'rider_withdrawal',
    fields: present([
      f('rider', `${w.rider.user.name} (${w.rider.badgeCode})`),
      f('store', w.darkStore.code, 'ltr'),
      f('amount', w.amountPiastres, 'money'),
      f('deduction', w.deductionPiastres || null, 'money'),
      f('method', w.method),
      f('createdAt', iso(w.createdAt), 'datetime'),
      f('approvedBy', w.approvedBy?.name ?? null),
      f('paidBy', w.paidBy?.name ?? null),
      f('paidAt', iso(w.paidAt), 'datetime'),
      f('reference', w.reference, 'ltr'),
      f('rejectedBy', w.rejectedBy?.name ?? null),
      f('reason', w.rejectReason, 'multiline'),
    ]),
    smart,
    attachments: files,
    attachTarget: w.entryId ? { entryId: w.entryId } : null,
    data: { darkStoreId: w.darkStoreId, riderId: w.riderId },
  });
}

// ─── finance request (approval) ─────────────────────────────────────────────────

async function requestDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const r = await db.financeRequest.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      entry: { select: { id: true, number: true } },
    },
  });
  if (!r) return null;
  const input = ((r.payload as { input?: Record<string, unknown> } | null)?.input ?? {}) as Record<
    string,
    unknown
  >;
  const text = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  const files = await receipts(db, {
    requestId: r.id,
    entryId: r.entry ? { in: [r.entry.id] } : undefined,
  });
  const smart: DocSmartButton[] = [{ key: 'receipts', count: files.length, href: '#attachments' }];
  if (r.entry)
    smart.push({
      key: 'entry',
      count: null,
      value: entryNumber(r.entry.number),
      href: `/finance/journal/${r.entry.id}`,
    });
  return base('finance_request', r.id, {
    number: r.entry ? entryNumber(r.entry.number) : `REQ-${r.id.slice(-6).toUpperCase()}`,
    title: text('reference') ?? text('reason') ?? r.kind,
    status: r.status,
    flow: 'finance_request',
    fields: present([
      f('kind', r.kind),
      f('amount', r.amountPiastres, 'money'),
      f('reference', text('reference') ?? text('reason'), 'text'),
      f('memo', text('memo'), 'multiline'),
      f('day', text('day'), 'date'),
      f('requestedBy', r.requestedBy.name),
      f('createdAt', iso(r.createdAt), 'datetime'),
      f('decidedBy', r.decidedBy?.name ?? null),
      f('decidedAt', iso(r.decidedAt), 'datetime'),
      f('decisionNote', r.decisionNote, 'multiline'),
    ]),
    smart,
    attachments: files,
    attachTarget: r.entry ? { entryId: r.entry.id } : { requestId: r.id },
    data: { requestedById: r.requestedById, darkStoreId: text('darkStoreId') },
  });
}

// ─── petty cash ─────────────────────────────────────────────────────────────────

async function pettyDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const p = await db.pettyCashExpense.findUnique({
    where: { id },
    include: {
      darkStore: { select: { code: true } },
      expenseAccount: { select: { code: true, nameEn: true } },
      createdBy: { select: { name: true } },
      reversedBy: { select: { name: true } },
      request: { select: { id: true, status: true, decisionNote: true } },
      entry: { select: { id: true, number: true } },
      reversalEntry: { select: { id: true, number: true } },
    },
  });
  if (!p) return null;
  const smart: DocSmartButton[] = [];
  if (p.entry)
    smart.push({
      key: 'entry',
      count: null,
      value: entryNumber(p.entry.number),
      href: `/finance/journal/${p.entry.id}`,
    });
  if (p.reversalEntry)
    smart.push({
      key: 'reversal',
      count: null,
      value: entryNumber(p.reversalEntry.number),
      href: `/finance/journal/${p.reversalEntry.id}`,
    });
  if (p.request)
    smart.push({
      key: 'request',
      count: null,
      value: p.request.status,
      href: `/finance/approvals/${p.request.id}`,
    });
  return base('petty_cash', p.id, {
    number: pettyCashLabel(p.number),
    title: p.darkStore.code,
    status: pettyStatusOf(p),
    flow: 'petty_cash',
    fields: present([
      f('store', p.darkStore.code, 'ltr'),
      f('category', `${p.expenseAccount.code} ${p.expenseAccount.nameEn}`),
      f('amount', p.amountPiastres, 'money'),
      f('note', p.note, 'multiline'),
      f('createdBy', p.createdBy.name),
      f('createdAt', iso(p.createdAt), 'datetime'),
      f('decisionNote', p.request?.decisionNote ?? null, 'multiline'),
      f('reversedBy', p.reversedBy?.name ?? null),
      f('reason', p.reverseReason, 'multiline'),
    ]),
    smart,
    attachments: [
      await photoAttachment(db, p.photoId, p.createdAt, p.createdBy.name),
      ...(
        await attachmentsFor(db, {
          entryIds: [p.entry?.id, p.reversalEntry?.id].filter((x): x is string => !!x),
          requestIds: p.request ? [p.request.id] : [],
        })
      ).filter((a) => a.photoId !== p.photoId),
    ],
    attachTarget: p.entry
      ? { entryId: p.entry.id }
      : p.request
        ? { requestId: p.request.id }
        : null,
    data: { darkStoreId: p.darkStoreId },
  });
}

// ─── tax invoice and purchase order (pages of their own; smart buttons here) ────

async function invoiceDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const r = await db.taxInvoice.findUnique({
    where: { id },
    include: {
      merchant: { select: { id: true, name: true } },
      _count: { select: { creditNotes: { where: { type: 'credit_note' } } } },
      original: { select: { id: true, type: true, number: true } },
    },
  });
  if (!r) return null;
  const smart: DocSmartButton[] = [
    {
      key: 'merchant',
      count: null,
      value: r.merchant.name,
      href: `/finance/merchants/${r.merchant.id}`,
    },
    {
      key: 'creditNotes',
      count: r._count.creditNotes,
      href: `/finance/invoices?q=${encodeURIComponent(r.merchant.name)}&f=credit_note`,
    },
  ];
  // Debit notes hang off their invoice like credit notes (original_id).
  if (r.type === 'invoice')
    smart.push({
      key: 'debitNotes',
      count: await db.taxInvoice.count({ where: { originalId: r.id, type: 'debit_note' } }),
      href: `/finance/invoices?q=${encodeURIComponent(r.merchant.name)}&f=debit_note`,
    });
  if (r.entryId) smart.push({ key: 'entries', count: 1, href: `/finance/journal/${r.entryId}` });
  if (r.original)
    smart.push({
      key: 'original',
      count: null,
      value: invoiceLabel(r.original.type, r.original.number),
      href: `/finance/invoices/${r.original.id}`,
    });
  return base('tax_invoice', r.id, {
    number: invoiceLabel(r.type, r.number),
    title: r.merchant.name,
    status: r.etaStatus,
    flow: 'eta',
    fields: present([f('total', r.totalPiastres, 'money')]),
    smart,
    data: { merchantId: r.merchantId },
  });
}

async function purchaseOrderDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const r = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      _count: { select: { bills: true, receipts: true, lines: true } },
    },
  });
  if (!r) return null;
  const number = purchaseOrderNumber(r.number);
  return base('purchase_order', r.id, {
    number,
    title: r.supplier.name,
    status: r.status,
    flow: 'purchase_order',
    fields: present([f('total', r.totalPiastres, 'money')]),
    smart: [
      { key: 'lines', count: r._count.lines, href: '#lines' },
      { key: 'deliveries', count: r._count.receipts, href: '#lines' },
      {
        key: 'bills',
        count: r._count.bills,
        href: `/finance/bills?q=${encodeURIComponent(r.supplier.name)}&f=`,
      },
    ],
    data: { darkStoreId: r.darkStoreId },
  });
}

// ─── supplier ───────────────────────────────────────────────────────────────────

/**
 * A supplier's page: its details (edited on the page), what we owe them (their 2500 wallet,
 * below zero they owe us), and smart buttons to their bills, payments, purchase orders and
 * the ledger lines of their wallet.
 */
async function supplierDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const s = await db.supplier.findUnique({
    where: { id },
    include: {
      accounts: { select: { id: true, code: true } },
      defaultExpenseAccount: { select: { id: true, code: true, nameEn: true } },
      _count: {
        select: {
          bills: true,
          purchaseOrders: true,
          cheques: true,
          staff: { where: { status: { not: 'left' } } },
        },
      },
    },
  });
  if (!s) return null;
  const accountIds = s.accounts.map((a) => a.id);
  const [sum, bills, openBills] = await Promise.all([
    db.ledgerLine.aggregate({
      where: { accountId: { in: accountIds } },
      _sum: { amountPiastres: true },
    }),
    db.bill.findMany({ where: { supplierId: s.id }, select: { id: true } }),
    db.bill.count({ where: { supplierId: s.id, status: 'open' } }),
  ]);
  const payments = bills.length
    ? await db.ledgerEntry.findMany({
        where: {
          kind: 'bill_payment',
          OR: bills.map((b) => ({ data: { path: ['billId'], equals: b.id } })),
        },
        select: { id: true },
      })
    : [];
  // Their wallet holds a credit balance when we owe them: shown positive.
  const owed = -(sum._sum.amountPiastres ?? 0);
  const account = s.accounts[0];
  const q = encodeURIComponent(s.name);
  const smart: DocSmartButton[] = [
    { key: 'bills', count: s._count.bills, href: `/finance/bills?q=${q}&f=` },
    {
      key: 'payments',
      count: payments.length,
      href: journalHref(
        payments.map((p) => p.id),
        s.name,
      ),
    },
    {
      key: 'purchaseOrders',
      count: s._count.purchaseOrders,
      href: `/finance/purchase-orders?supplierId=${s.id}`,
    },
    {
      key: 'supplierBalance',
      count: null,
      value: `${egpText(owed)} EGP`,
      href: account ? `/finance/reports/lines?account=${account.id}` : '#details',
    },
  ];
  if (s._count.cheques)
    smart.push({ key: 'cheques', count: s._count.cheques, href: `/finance/cheques?q=${q}&f=` });
  if (s.isRiderOffice)
    smart.push({
      key: 'riderOffice',
      count: null,
      value: s.name,
      href: `/finance/rider-offices/${s.id}`,
    });
  return base('supplier', s.id, {
    number: account?.code ?? s.name,
    title: s.name,
    status: s.isActive ? 'active' : 'inactive',
    fields: present([
      f('name', s.name),
      f('taxId', s.taxId, 'ltr'),
      f('phone', s.phone, 'ltr'),
      f('email', s.email, 'ltr'),
      f('withholding', s.whtBp / 100, 'percent'),
      f(
        'defaultExpense',
        s.defaultExpenseAccount
          ? `${s.defaultExpenseAccount.code} ${s.defaultExpenseAccount.nameEn}`
          : null,
      ),
      f('walletAccount', account?.code ?? null, 'ltr'),
      f('commission', s.isRiderOffice ? s.commissionBp / 100 : null, 'percent'),
      f('people', s._count.staff || null),
      f('openBills', openBills),
      f('weOwe', owed, 'money'),
      f('createdAt', iso(s.createdAt), 'datetime'),
    ]),
    smart,
    data: {
      name: s.name,
      taxId: s.taxId,
      phone: s.phone,
      email: s.email,
      whtBp: s.whtBp,
      defaultExpenseAccountId: s.defaultExpenseAccountId,
      isActive: s.isActive,
      isRiderOffice: s.isRiderOffice,
      owedPiastres: owed,
    },
  });
}

async function handoverDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const h = await db.cashHandover.findUnique({
    where: { id },
    include: { rider: { select: { badgeCode: true } } },
  });
  if (!h) return null;
  return base('cash_handover', h.id, {
    number: handoverNumber(h.number),
    title: h.rider.badgeCode,
    status: h.status,
    flow: 'handover',
    fields: present([
      f('expected', h.expectedPiastres, 'money'),
      f('counted', h.countedPiastres, 'money'),
      f('difference', h.differencePiastres, 'money'),
    ]),
    data: { darkStoreId: h.darkStoreId },
  });
}

// ─── expense claim ──────────────────────────────────────────────────────────────

async function claimDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const c = await db.expenseClaim.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      darkStore: { select: { code: true } },
      expenseAccount: { select: { code: true, nameEn: true } },
      managerDecidedBy: { select: { name: true } },
      paidBy: { select: { name: true } },
      paidFrom: { select: { code: true, nameEn: true } },
      rejectedBy: { select: { name: true } },
      entry: { select: { id: true, number: true } },
    },
  });
  if (!c) return null;
  const smart: DocSmartButton[] = [
    {
      key: 'person',
      count: null,
      value: c.user.name,
      href: `/finance/expense-claims?q=${encodeURIComponent(c.user.name)}&f=`,
    },
  ];
  if (c.entry)
    smart.push({
      key: 'entry',
      count: null,
      value: entryNumber(c.entry.number),
      href: `/finance/journal/${c.entry.id}`,
    });
  const limit = await getSetting(db, 'finance.approval_threshold_piastres');
  return base('expense_claim', c.id, {
    number: expenseClaimNumber(c.number),
    title: c.user.name,
    status: c.status,
    flow: 'expense_claim',
    fields: present([
      f('person', c.user.name),
      f('store', c.darkStore?.code ?? null, 'ltr'),
      f('category', `${c.expenseAccount.code} ${c.expenseAccount.nameEn ?? ''}`.trim()),
      f('amount', c.amountPiastres, 'money'),
      // VAT on a tax invoice receipt, claimed back when paid (inside the amount)
      f('vat', c.vatPiastres || null, 'money'),
      f('paidOn', dbDay(c.paidOn), 'date'),
      f('note', c.note, 'multiline'),
      f('createdAt', iso(c.createdAt), 'datetime'),
      f('approvedBy', c.managerDecidedBy?.name ?? null),
      f('approvedAt', iso(c.managerDecidedAt), 'datetime'),
      f('paidBy', c.paidBy?.name ?? null),
      f('paidAt', iso(c.paidAt), 'datetime'),
      f('paidFrom', c.paidFrom ? `${c.paidFrom.code} ${c.paidFrom.nameEn ?? ''}`.trim() : null),
      f('reference', c.reference, 'ltr'),
      f('rejectedBy', c.rejectedBy?.name ?? null),
      f('reason', c.rejectReason, 'multiline'),
    ]),
    smart,
    attachments: [
      await photoAttachment(db, c.photoId, c.createdAt, c.user.name),
      ...(c.entry ? await attachmentsFor(db, { entryIds: [c.entry.id] }) : []).filter(
        (a) => a.photoId !== c.photoId,
      ),
    ],
    attachTarget: c.entry ? { entryId: c.entry.id } : null,
    actions: c.status === 'pending_accounting' ? ['pay', 'reject'] : [],
    data: {
      darkStoreId: c.darkStoreId,
      userId: c.userId,
      amountPiastres: c.amountPiastres,
      managerDecidedById: c.managerDecidedById,
      // The second person rule applies from the approval limit.
      secondPerson: limit > 0 && c.amountPiastres >= limit,
    },
  });
}

// ─── Basata deposit ─────────────────────────────────────────────────────────────

async function basataDoc(db: Db, id: string): Promise<DocDescriptor | null> {
  const d = await db.basataDeposit.findUnique({
    where: { id },
    include: {
      rider: {
        select: {
          id: true,
          badgeCode: true,
          userId: true,
          frozenAt: true,
          user: { select: { name: true } },
        },
      },
      darkStore: { select: { code: true } },
      decidedBy: { select: { name: true } },
      entry: { select: { id: true, number: true } },
      settlement: {
        select: {
          id: true,
          number: true,
          receivedOn: true,
          entry: { select: { id: true, number: true } },
        },
      },
    },
  });
  if (!d) return null;
  const rider = `${d.rider.user.name} (${d.rider.badgeCode})`;
  const smart: DocSmartButton[] = [
    {
      key: 'rider',
      count: null,
      value: rider,
      href: `/finance/basata?v=rider:${d.riderId}&f=`,
    },
  ];
  if (d.entry)
    smart.push({
      key: 'entry',
      count: null,
      value: entryNumber(d.entry.number),
      href: `/finance/journal/${d.entry.id}`,
    });
  if (d.settlement)
    smart.push({
      key: 'settlement',
      count: null,
      value: basataSettlementNumber(d.settlement.number),
      href: `/finance/journal/${d.settlement.entry.id}`,
    });
  return base('basata_deposit', d.id, {
    number: basataDepositNumber(d.number),
    title: rider,
    status: d.status,
    flow: 'basata_deposit',
    fields: present([
      f('rider', rider),
      f('store', d.darkStore.code, 'ltr'),
      f('amount', d.amountPiastres, 'money'),
      f('reference', d.reference, 'ltr'),
      f('depositedAt', iso(d.depositedAt), 'datetime'),
      f('createdAt', iso(d.createdAt), 'datetime'),
      f('deadlineDay', dbDay(d.deadlineDay), 'date'),
      f('decidedBy', d.decidedBy?.name ?? null),
      f('decidedAt', iso(d.decidedAt), 'datetime'),
      f('heldPart', d.heldPiastres, 'money'),
      f('givenBack', d.givenBackPiastres || null, 'money'),
      f('reason', d.rejectReason, 'multiline'),
      f('settledOn', d.settlement ? dbDay(d.settlement.receivedOn) : null, 'date'),
    ]),
    smart,
    attachments: [
      await photoAttachment(db, d.photoId, d.createdAt, d.rider.user.name),
      ...(d.entry ? await attachmentsFor(db, { entryIds: [d.entry.id] }) : []).filter(
        (a) => a.photoId !== d.photoId,
      ),
    ],
    attachTarget: d.entry ? { entryId: d.entry.id } : null,
    actions: d.status === 'pending' ? ['approve', 'reject'] : [],
    data: {
      darkStoreId: d.darkStoreId,
      riderUserId: d.rider.userId,
      photoId: d.photoId,
      frozen: Boolean(d.rider.frozenAt),
    },
  });
}

const BUILDERS: Record<AccountingDoc, (db: Db, id: string) => Promise<DocDescriptor | null>> = {
  payout: payoutDoc,
  bill: billDoc,
  ledger_entry: entryDoc,
  cheque: chequeDoc,
  rider_withdrawal: withdrawalDoc,
  finance_request: requestDoc,
  petty_cash: pettyDoc,
  tax_invoice: invoiceDoc,
  purchase_order: purchaseOrderDoc,
  cash_handover: handoverDoc,
  expense_claim: claimDoc,
  basata_deposit: basataDoc,
  supplier: supplierDoc,
};

/** The document page of one accounting record, or null when it does not exist. */
export function accountingDocument(db: Db, type: AccountingDoc, id: string) {
  return BUILDERS[type](db, id);
}
