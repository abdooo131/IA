import {
  addBuckets,
  addDays,
  type AgingBand,
  agingBand,
  type AgingBuckets,
  billNumber,
  bucketsOf,
  cairoDay,
  cairoDayStart,
  chequeLabel,
  daysBetweenDays,
  emptyBuckets,
  isCalendarDay,
  openDebits,
  sumBuckets,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';

// Aging reports: who owes us and what we owe suppliers, by how old it is, as of a Cairo day.
//
// Who owes us (receivables):
//   - merchants whose wallet is in debit at the end of the day. A wallet has no due dates, so
//     every debit (a fee, storage, a charge) counts from the day it was booked, and the cash we
//     collect for them and their payments pay the oldest debits first (first in, first out;
//     openDebits in packages/shared/src/aging.ts). An amount booked on the chosen day is "not
//     yet due"; one booked 1 to 30 days before is in 1 to 30, and so on;
//   - received cheques still under collection (1151) at the end of the day, by the day they may
//     be cashed: before it they are not yet due, after it they are late. Other receivables the
//     books hold (rider cash and dues, staff advances) are taken back from the person's
//     handovers, withdrawals or salary, never asked for, so they are not listed here.
//
// What we owe suppliers (payables): open supplier bills by their due day, each with what was
// still unpaid at the end of the chosen day (payments made after it, cancellations after it
// and payments by cheques that bounced only later are counted as they stood that day).

export interface AgingScope {
  /** Only these merchants (account managers); null: every merchant */
  merchantIds?: string[] | null;
  /** Only bills of these stores (people limited to some stores); null: every bill */
  storeIds?: string[] | null;
}

const endOf = (day: string) => cairoDayStart(addDays(day, 1));

function checkDay(day: string) {
  if (!isCalendarDay(day)) throw new DomainError('invalid_date', 400);
}

const matches = (q: string | undefined, ...texts: (string | null | undefined)[]) => {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return texts.some((t) => t?.toLowerCase().includes(needle));
};

export interface ReceivableAgingRow {
  merchantId: string;
  name: string;
  phone: string | null;
  balancePiastres: number;
  buckets: AgingBuckets;
  /** The day the oldest unpaid amount was booked */
  oldestDay: string | null;
  oldestDays: number | null;
  /** When the wallet last turned to debit (the current debit period) */
  since: Date | null;
  daysInDebit: number | null;
  /** Payment reminders sent in this debit period up to the end of the day */
  reminders: { count: number; lastAt: Date | null };
  /** The last "Ask to pay" request (payment_requested), if any */
  lastRequestedAt: Date | null;
}

export interface ChequeAgingRow {
  id: string;
  label: string;
  chequeNumber: string;
  partyName: string;
  merchantId: string | null;
  dueDay: string;
  daysLate: number;
  band: AgingBand;
  amountPiastres: number;
}

/**
 * Who owes us on a Cairo day, by age: merchants in debit (aged first in, first out) and
 * cheques under collection (aged by their due day), each with totals per band.
 */
export async function receivablesAging(
  db: Db,
  input: { day?: string; q?: string; now?: Date } & AgingScope,
) {
  const asOf = input.day ?? cairoDay(input.now ?? new Date());
  checkDay(asOf);
  const end = endOf(asOf);

  // Wallets in debit at the end of the day.
  const debit = await db.$queryRaw<{ account_id: string; merchant_id: string }[]>`
    SELECT a.id AS account_id, a.merchant_id
    FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.type = 'merchant' AND a.merchant_id IS NOT NULL AND l.occurred_at < ${end}
    GROUP BY a.id, a.merchant_id
    HAVING SUM(l.amount_piastres) > 0`;
  const allowed = input.merchantIds ? new Set(input.merchantIds) : null;
  const merchants = await db.merchant.findMany({
    where: { id: { in: debit.map((d) => d.merchant_id) } },
    select: { id: true, name: true, legalName: true, contactPhone: true },
  });
  const wanted = debit.filter((d) => {
    if (allowed && !allowed.has(d.merchant_id)) return false;
    const m = merchants.find((x) => x.id === d.merchant_id);
    return matches(input.q, m?.name, m?.legalName, m?.contactPhone);
  });

  const lines = wanted.length
    ? await db.ledgerLine.findMany({
        where: { accountId: { in: wanted.map((w) => w.account_id) }, occurredAt: { lt: end } },
        select: { accountId: true, amountPiastres: true, occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const ids = wanted.map((w) => w.merchant_id);
  const [reminders, requests] = await Promise.all([
    db.merchantPaymentReminder.findMany({
      where: { merchantId: { in: ids }, createdAt: { lt: end } },
      orderBy: { createdAt: 'asc' },
      select: { merchantId: true, periodStart: true, createdAt: true },
    }),
    db.auditLog.findMany({
      where: {
        action: 'finance.payment_requested',
        entityId: { in: ids },
        createdAt: { lt: end },
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, createdAt: true },
    }),
  ]);

  const rows: ReceivableAgingRow[] = [];
  for (const w of wanted) {
    const own = lines.filter((l) => l.accountId === w.account_id);
    // The debit period: from the first line after the balance was last zero or in credit.
    let running = 0;
    let since: Date | null = null;
    for (const l of own) {
      if (running <= 0 && running + l.amountPiastres > 0) since = l.occurredAt;
      running += l.amountPiastres;
      if (running <= 0) since = null;
    }
    const { open } = openDebits(
      own.map((l) => ({ amount: l.amountPiastres, day: cairoDay(l.occurredAt) })),
    );
    const buckets = bucketsOf(open, asOf);
    const m = merchants.find((x) => x.id === w.merchant_id);
    const sent = reminders.filter(
      (r) => r.merchantId === w.merchant_id && since && r.periodStart.getTime() === since.getTime(),
    );
    rows.push({
      merchantId: w.merchant_id,
      name: m?.name ?? w.merchant_id,
      phone: m?.contactPhone ?? null,
      balancePiastres: running,
      buckets,
      oldestDay: open[0]?.day ?? null,
      oldestDays: open[0] ? daysBetweenDays(open[0].day, asOf) : null,
      since,
      daysInDebit: since ? daysBetweenDays(cairoDay(since), asOf) : null,
      reminders: { count: sent.length, lastAt: sent.at(-1)?.createdAt ?? null },
      lastRequestedAt: requests.find((r) => r.entityId === w.merchant_id)?.createdAt ?? null,
    });
  }
  rows.sort((a, b) => b.balancePiastres - a.balancePiastres);
  const merchantTotal = emptyBuckets();
  for (const r of rows) addBuckets(merchantTotal, r.buckets);

  // Received cheques booked but not yet cleared, bounced or cancelled at the end of the day.
  const cheques = await db.cheque.findMany({
    where: {
      direction: 'received',
      bookEntry: { occurredAt: { lt: end } },
      AND: [
        { OR: [{ clearedAt: null }, { clearedAt: { gte: end } }] },
        { OR: [{ bouncedAt: null }, { bouncedAt: { gte: end } }] },
        { OR: [{ cancelledAt: null }, { cancelledAt: { gte: end } }] },
      ],
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      number: true,
      chequeNumber: true,
      partyName: true,
      merchantId: true,
      dueDate: true,
      amountPiastres: true,
    },
  });
  const chequeRows: ChequeAgingRow[] = cheques
    .filter((c) => !allowed || (c.merchantId !== null && allowed.has(c.merchantId)))
    .filter((c) => matches(input.q, c.partyName, c.chequeNumber, chequeLabel(c.number)))
    .map((c) => {
      const dueDay = c.dueDate.toISOString().slice(0, 10);
      const daysLate = daysBetweenDays(dueDay, asOf);
      return {
        id: c.id,
        label: chequeLabel(c.number),
        chequeNumber: c.chequeNumber,
        partyName: c.partyName,
        merchantId: c.merchantId,
        dueDay,
        daysLate,
        band: agingBand(daysLate),
        amountPiastres: c.amountPiastres,
      };
    });
  const chequeTotal = emptyBuckets();
  for (const c of chequeRows) chequeTotal[c.band] += c.amountPiastres;
  const grand = emptyBuckets();
  addBuckets(grand, merchantTotal);
  addBuckets(grand, chequeTotal);

  return {
    asOf,
    merchants: rows,
    merchantTotal: { buckets: merchantTotal, total: sumBuckets(merchantTotal) },
    cheques: chequeRows,
    chequeTotal: { buckets: chequeTotal, total: sumBuckets(chequeTotal) },
    total: { buckets: grand, total: sumBuckets(grand) },
  };
}

export interface PayableBillRow {
  id: string;
  label: string;
  reference: string;
  billDay: string;
  dueDay: string;
  daysLate: number;
  band: AgingBand;
  currency: string;
  darkStoreId: string | null;
  /** What was still unpaid at the end of the day (EGP at the bill's rate) */
  leftPiastres: number;
}

export interface PayableAgingRow {
  supplierId: string;
  name: string;
  taxId: string | null;
  buckets: AgingBuckets;
  total: number;
  bills: PayableBillRow[];
}

/**
 * What we owe suppliers on a Cairo day, by how late each bill is against its due day: per
 * supplier with its bills, and totals per band. A store filter (or a person limited to some
 * stores) keeps only bills of those stores.
 */
export async function payablesAging(
  db: Db,
  input: { day?: string; q?: string; storeId?: string | null; now?: Date } & AgingScope,
) {
  const asOf = input.day ?? cairoDay(input.now ?? new Date());
  checkDay(asOf);
  const end = endOf(asOf);
  const storeWhere = input.storeId
    ? { darkStoreId: input.storeId }
    : input.storeIds
      ? { darkStoreId: { in: input.storeIds } }
      : {};
  const bills = await db.bill.findMany({
    where: { billDate: { lte: new Date(`${asOf}T00:00:00Z`) }, ...storeWhere },
    include: { supplier: { select: { id: true, name: true, taxId: true } } },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
  });
  if (bills.length === 0) return emptyPayables(asOf);
  const billIds = bills.map((b) => b.id);
  // Payments and cancellations booked by the end of the day; a payment counts only while the
  // cheque that paid it had not bounced or been cancelled by then.
  const entries = await db.$queryRaw<
    { id: string; kind: string; bill_id: string; gross: number }[]
  >`
    SELECT e.id, e.kind, e.data->>'billId' AS bill_id,
      COALESCE((e.data->>'gross')::bigint, 0)::int AS gross
    FROM ledger_entries e
    WHERE e.kind IN ('bill_payment', 'supplier_bill_cancel')
      AND e.occurred_at < ${end}
      AND e.data->>'billId' = ANY(${billIds})`;
  const reversed = new Set(
    (
      await db.$queryRaw<{ id: string }[]>`
        SELECT e.data->>'reverses' AS id FROM ledger_entries e
        WHERE e.kind IN ('cheque_bounced', 'cheque_cancelled')
          AND e.data->>'reverses' IS NOT NULL AND e.occurred_at < ${end}`
    ).map((r) => r.id),
  );
  const paid = new Map<string, number>();
  const cancelled = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'supplier_bill_cancel') cancelled.add(e.bill_id);
    else if (!reversed.has(e.id)) paid.set(e.bill_id, (paid.get(e.bill_id) ?? 0) + e.gross);
  }

  const rows = new Map<string, PayableAgingRow>();
  for (const b of bills) {
    if (cancelled.has(b.id)) continue;
    const left = b.totalPiastres - (paid.get(b.id) ?? 0);
    if (left <= 0) continue;
    if (!matches(input.q, b.supplier.name, b.supplier.taxId, b.reference, billNumber(b.number)))
      continue;
    const dueDay = b.dueDate.toISOString().slice(0, 10);
    const daysLate = daysBetweenDays(dueDay, asOf);
    const band = agingBand(daysLate);
    const row = rows.get(b.supplierId) ?? {
      supplierId: b.supplierId,
      name: b.supplier.name,
      taxId: b.supplier.taxId,
      buckets: emptyBuckets(),
      total: 0,
      bills: [],
    };
    row.buckets[band] += left;
    row.total += left;
    row.bills.push({
      id: b.id,
      label: billNumber(b.number),
      reference: b.reference,
      billDay: b.billDate.toISOString().slice(0, 10),
      dueDay,
      daysLate,
      band,
      currency: b.currency,
      darkStoreId: b.darkStoreId,
      leftPiastres: left,
    });
    rows.set(b.supplierId, row);
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total);
  const total = emptyBuckets();
  for (const r of list) addBuckets(total, r.buckets);
  return { asOf, suppliers: list, total: { buckets: total, total: sumBuckets(total) } };
}

function emptyPayables(asOf: string) {
  return {
    asOf,
    suppliers: [] as PayableAgingRow[],
    total: { buckets: emptyBuckets(), total: 0 },
  };
}
