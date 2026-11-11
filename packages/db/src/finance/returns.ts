import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { addMonths } from './assets';
import { balanceSheet, profitAndLoss } from './books';
import { balanceOf, post } from './ledger';
import { reversedPaymentIds } from './payables';
import { payslips } from './payroll';
import { VAT_PURCHASE_KINDS } from './period';

// Worksheets for the returns the accountant files, built from the books: the monthly VAT
// return, the quarterly withholding tax list (form 41) payment by payment, the monthly
// salary tax and social insurance lists per employee, the company income tax estimate,
// and statements next to the previous period for printing.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthRange = (month: string) => ({
  from: cairoDayStart(`${month}-01`),
  to: cairoDayStart(`${addMonths(month, 1)}-01`),
});

// ─── VAT return ────────────────────────────────────────────────────────────────

/**
 * The month's VAT return: our taxable sales (fees) and the VAT on them, credit notes
 * taking some back, purchases with VAT claimed back, what is due, and the credit carried
 * from earlier months when more VAT was paid than charged.
 */
export async function vatReturn(db: Db, month: string) {
  if (!MONTH.test(month)) throw new DomainError('invalid_month', 400);
  const { from, to } = monthRange(month);
  const rows = await db.$queryRaw<
    {
      kind: string;
      revenue: bigint | null;
      vat: bigint | null;
      expense: bigint | null;
      on_wallet: bigint | null;
    }[]
  >`
    SELECT e.kind,
      SUM((e.data->>'onWalletPiastres')::int) FILTER (WHERE a.key = 'vat_payable') AS on_wallet,
      SUM(l.amount_piastres) FILTER (WHERE a.key = 'revenue') AS revenue,
      SUM(l.amount_piastres) FILTER (WHERE a.key = 'vat_payable') AS vat,
      SUM(l.amount_piastres) FILTER (WHERE a.category = 'expense' OR a.key IN ('goods_received', 'rider_office_accrued')) AS expense
    FROM ledger_entries e
      JOIN ledger_lines l ON l.entry_id = e.id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE l.occurred_at >= ${from} AND l.occurred_at < ${to}
      AND e.kind NOT IN ('year_close', 'tax_payment')
      AND e.id IN (SELECT entry_id FROM ledger_lines vl JOIN ledger_accounts va ON va.id = vl.account_id
                   WHERE va.key = 'vat_payable')
    GROUP BY e.kind`;
  let sales = 0;
  let outputVat = 0;
  let creditNotes = 0;
  let creditNoteVat = 0;
  // Debit notes are sales (output VAT) like the monthly fees; shown apart as "of which".
  let debitNotes = 0;
  let debitNoteVat = 0;
  let purchases = 0;
  let inputVat = 0;
  for (const r of rows) {
    const revenue = -Number(r.revenue ?? 0);
    const vat = -Number(r.vat ?? 0);
    // By the entry's kind: a cancelled bill takes its purchase and VAT back in its month,
    // a purchase order bill's cost sits in goods received not billed (2401), a rider office's
    // commission bill in its accrued commission (2402) for deliveries booked before 2026-11-11;
    // since then the commission is on the office wallet at delivery and the bill's entry
    // carries it as onWalletPiastres (one vat_payable line per entry, so counted once).
    if (r.kind === 'credit_note') {
      creditNotes += -revenue;
      creditNoteVat += -vat;
    } else if (VAT_PURCHASE_KINDS.includes(r.kind)) {
      purchases += Number(r.expense ?? 0) + Number(r.on_wallet ?? 0);
      inputVat += -vat;
    } else if (revenue !== 0 || vat > 0) {
      sales += revenue;
      outputVat += vat;
      if (r.kind === 'debit_note') {
        debitNotes += revenue;
        debitNoteVat += vat;
      }
    } else {
      purchases += Number(r.expense ?? 0);
      inputVat += -vat;
    }
  }
  // Earlier months' VAT balance (net of payments): a debit balance is credit carried in.
  const before = await balanceOf(db, { type: 'vat_payable' }, from);
  const carriedIn = before > 0 ? before : 0;
  const due = outputVat - creditNoteVat - inputVat - carriedIn;
  const paid = await db.$queryRaw<{ paid: bigint | null }[]>`
    SELECT SUM(l.amount_piastres) AS paid FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.key = 'vat_payable' AND e.kind = 'tax_payment'
      AND e.data->>'tax' = 'vat' AND l.occurred_at >= ${to}`;
  return {
    month,
    salesPiastres: sales,
    outputVatPiastres: outputVat,
    creditNotesPiastres: creditNotes,
    creditNoteVatPiastres: creditNoteVat,
    debitNotesPiastres: debitNotes,
    debitNoteVatPiastres: debitNoteVat,
    purchasesPiastres: purchases,
    inputVatPiastres: inputVat,
    carriedInPiastres: carriedIn,
    duePiastres: Math.max(due, 0),
    carriedOutPiastres: due < 0 ? -due : 0,
    paidSincePiastres: Number(paid[0]?.paid ?? 0),
  };
}

// ─── withholding tax, form 41 ──────────────────────────────────────────────────

/** Every payment that kept withholding tax in a quarter, one row each (form 41). */
export async function withholdingPayments(db: Db, input: { year: number; quarter: number }) {
  if (!Number.isInteger(input.year) || ![1, 2, 3, 4].includes(input.quarter))
    throw new DomainError('invalid_quarter', 400);
  const first = `${input.year}-${String((input.quarter - 1) * 3 + 1).padStart(2, '0')}`;
  const from = cairoDayStart(`${first}-01`);
  const to = cairoDayStart(`${addMonths(first, 3)}-01`);
  const entries = await db.ledgerEntry.findMany({
    where: {
      kind: 'bill_payment',
      occurredAt: { gte: from, lt: to },
      // A payment by a cheque that bounced or was cancelled was never made.
      id: { notIn: await reversedPaymentIds(db) },
    },
    orderBy: { occurredAt: 'asc' },
    select: { number: true, occurredAt: true, data: true },
  });
  const suppliers = await db.supplier.findMany({
    select: { id: true, name: true, taxId: true, whtBp: true },
  });
  return entries
    .map((e) => {
      const d = e.data as { supplierId: string; net: number; wht: number; reference?: string };
      const s = suppliers.find((x) => x.id === d.supplierId);
      return {
        day: cairoDay(e.occurredAt),
        entryNumber: e.number,
        supplier: s?.name ?? '',
        taxId: s?.taxId ?? '',
        netPiastres: d.net,
        rateBp: d.net ? Math.round((d.wht * 10_000) / d.net) : (s?.whtBp ?? 0),
        whtPiastres: d.wht,
        reference: d.reference ?? '',
      };
    })
    .filter((r) => r.whtPiastres > 0);
}

// ─── salary tax and social insurance ───────────────────────────────────────────

/** The month's salary run per employee, with the numbers the tax and insurance forms ask for. */
export async function payrollForms(db: Db, month: string) {
  const run = await payslips(db, month);
  // National ID and insurance number live on the employee file (docs/HR.md).
  const files = await db.employee.findMany({
    where: { userId: { in: run.people.map((p) => p.userId) } },
    select: { userId: true, nationalId: true, socialInsuranceNumber: true },
  });
  const rows = run.people.map((p) => {
    const f = files.find((x) => x.userId === p.userId);
    return {
      ...p,
      nationalId: f?.nationalId ?? null,
      insuranceNumber: f?.socialInsuranceNumber ?? null,
    };
  });
  const sum = (
    k: 'gross' | 'incomeTax' | 'siEmployee' | 'siEmployer' | 'martyrs' | 'insuredWage',
  ) => rows.reduce((t, r) => t + r[k], 0);
  return {
    month,
    entryNumber: run.entryNumber,
    rows,
    totals: {
      grossPiastres: sum('gross'),
      incomeTaxPiastres: sum('incomeTax'),
      insuredWagesPiastres: sum('insuredWage'),
      siEmployeePiastres: sum('siEmployee'),
      siEmployerPiastres: sum('siEmployer'),
      martyrsPiastres: sum('martyrs'),
    },
    missingIds: rows.filter((r) => !r.nationalId || !r.insuranceNumber).length,
  };
}

// ─── company income tax ────────────────────────────────────────────────────────

const yearRange = (year: number) => ({
  from: cairoDayStart(`${year}-01-01`),
  to: cairoDayStart(`${year + 1}-01-01`),
});

/**
 * The year's company income tax: accounting profit before tax (the tax itself left out)
 * times the rate setting, against what is already booked for the year. The accountant
 * adjusts the taxable profit (costs the law does not accept) in the amount booked.
 */
export async function corporateTaxEstimate(db: Db, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new DomainError('invalid_year', 400);
  const { from, to } = yearRange(year);
  const pl = await profitAndLoss(db, from, to);
  const taxLine = pl.expenses.find((e) => e.code === '5801');
  const booked = taxLine?.amountPiastres ?? 0;
  const profitBeforeTax = pl.profitPiastres + booked;
  const rateBp = await getSetting(db, 'finance.corporate_tax_bp');
  return {
    year,
    profitBeforeTaxPiastres: profitBeforeTax,
    rateBp,
    estimatePiastres: profitBeforeTax > 0 ? Math.round((profitBeforeTax * rateBp) / 10_000) : 0,
    bookedPiastres: booked,
  };
}

/**
 * Books the year's company income tax (the amount the accountant settles on) on the year's
 * last moment: tax expense against tax payable. Before closing the year; booked again with
 * a new amount, only the difference is posted.
 */
export async function bookCorporateTax(
  db: Db,
  input: { year: number; amountPiastres: number; actorUserId: string; now?: Date },
) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  const thisYear = Number(cairoDay(input.now ?? new Date()).slice(0, 4));
  if (input.year >= thisYear) throw new DomainError('year_not_over', 400);
  return inTransaction(db, async (tx) => {
    if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: `year_close:${input.year}` } }))
      throw new DomainError('year_already_closed');
    const estimate = await corporateTaxEstimate(tx as Db, input.year);
    const diff = input.amountPiastres - estimate.bookedPiastres;
    if (diff === 0) return { year: input.year, bookedPiastres: estimate.bookedPiastres };
    const count = await tx.ledgerEntry.count({
      where: { kind: 'corporate_tax', data: { path: ['year'], equals: input.year } },
    });
    await post(tx, {
      kind: 'corporate_tax',
      idempotencyKey: `corporate_tax:${input.year}:${count + 1}`,
      occurredAt: new Date(yearRange(input.year).to.getTime() - 2),
      createdById: input.actorUserId,
      memo: `Company income tax ${input.year}`,
      data: { year: input.year, amount: input.amountPiastres },
      lines: [
        { account: { type: 'income_tax_expense' }, amount: diff },
        { account: { type: 'corporate_tax_payable' }, amount: -diff },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.corporate_tax',
      entityType: 'ledger_entry',
      entityId: `corporate_tax:${input.year}`,
      before: { booked: estimate.bookedPiastres },
      after: { booked: input.amountPiastres },
    });
    return { year: input.year, bookedPiastres: input.amountPiastres };
  });
}

// ─── statements next to the previous period ────────────────────────────────────

/**
 * Profit and loss for a period and the balance sheet at its last day, each next to the
 * period of the same length just before it (for printing).
 */
export async function comparativeStatements(db: Db, input: { from: string; to: string }) {
  if (!isCalendarDay(input.from) || !isCalendarDay(input.to) || input.to < input.from)
    throw new DomainError('invalid_date', 400);
  const days =
    Math.round(
      (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  const prevTo = addDays(input.from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const [pl, plPrev, bs, bsPrev] = await Promise.all([
    profitAndLoss(db, cairoDayStart(input.from), cairoDayStart(addDays(input.to, 1))),
    profitAndLoss(db, cairoDayStart(prevFrom), cairoDayStart(input.from)),
    balanceSheet(db, input.to),
    balanceSheet(db, prevTo),
  ]);
  return {
    current: { from: input.from, to: input.to, pl, bs },
    previous: { from: prevFrom, to: prevTo, pl: plPrev, bs: bsPrev },
  };
}
