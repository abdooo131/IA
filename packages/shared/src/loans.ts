import { z } from 'zod';
import { attachmentIdsField } from './attachments';
import { isCalendarDay } from './hours';

// Loans the company borrowed, cost tags, and bank accounts in another currency
// (migration 20261231180000_loans_tags_fx).
//
// A loan's schedule is worked out once, in whole piastres, when the loan is recorded:
//
//   declining  equal monthly instalments (an annuity); each month's interest is the yearly
//              rate / 12 on what is still owed, the rest of the instalment repays principal
//   flat       interest on the whole amount every month (rate / 12 × amount), principal in
//              equal parts
//
// Every amount is rounded half up to the piastre and the last instalment takes whatever
// rounding left, so the principal parts always add up to the amount borrowed exactly.

const pad = (n: number) => String(n).padStart(6, '0');
/** A loan's number, for example LN-000001 */
export const loanNumber = (n: number) => `LN-${pad(n)}`;

export const LOAN_METHODS = ['declining', 'flat'] as const;
export type LoanMethodName = (typeof LOAN_METHODS)[number];

export interface LoanScheduleInput {
  principalPiastres: number;
  /** Yearly interest rate in basis points: 2,250 is 22.5% */
  annualRateBp: number;
  months: number;
  method: LoanMethodName;
  /** The Cairo day of the first instalment; the others fall on the same day of each month */
  firstPaymentDay: string;
}

export interface LoanScheduleRow {
  seq: number;
  dueDay: string;
  instalmentPiastres: number;
  interestPiastres: number;
  principalPiastres: number;
  /** Still owed after this instalment */
  remainingPiastres: number;
}

/** a × b / c rounded half up, exactly (BigInt), for non negative values. */
function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  return (a * b * 2n + c) / (2n * c);
}

/**
 * The same day of the month n months later; a day the month lacks (31 in April) becomes its
 * last day, so a loan paid on the 31st is paid on the 30th in April and back on the 31st in May.
 */
export function sameDayMonthsLater(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The repayment schedule of a loan, in whole piastres (see the comment at the top). */
export function loanSchedule(input: LoanScheduleInput): LoanScheduleRow[] {
  const { principalPiastres: principal, annualRateBp: bp, months: n } = input;
  if (!Number.isSafeInteger(principal) || principal <= 0) throw new Error('invalid_amount');
  if (!Number.isInteger(bp) || bp < 0 || bp > 100_000) throw new Error('invalid_rate');
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new Error('invalid_months');
  if (!isCalendarDay(input.firstPaymentDay)) throw new Error('invalid_date');
  const P = BigInt(principal);
  // One month's rate is bp / 120,000 (bp / 10,000 a year over 12 months).
  const MONTH = 120_000n;
  const rows: LoanScheduleRow[] = [];
  let remaining = P;

  if (input.method === 'flat') {
    const totalInterest = mulDivRound(P, BigInt(bp) * BigInt(n), MONTH);
    const interestEach = totalInterest / BigInt(n);
    const principalEach = P / BigInt(n);
    let interestLeft = totalInterest;
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const interest = last ? interestLeft : interestEach;
      const part = last ? remaining : principalEach;
      interestLeft -= interest;
      remaining -= part;
      rows.push(row(i, input.firstPaymentDay, part, interest, remaining));
    }
    return rows;
  }

  // Declining balance with an equal instalment: P × r × (1 + r)^n / ((1 + r)^n − 1), with
  // r = bp / 120,000, computed exactly as P × bp × A^n / (120,000 × (A^n − B^n)) where
  // A = 120,000 + bp and B = 120,000. A zero rate repays principal in equal parts.
  let payment: bigint;
  if (bp === 0) payment = mulDivRound(P, 1n, BigInt(n));
  else {
    const A = (MONTH + BigInt(bp)) ** BigInt(n);
    const B = MONTH ** BigInt(n);
    payment = mulDivRound(P * BigInt(bp), A, MONTH * (A - B));
  }
  for (let i = 1; i <= n; i++) {
    const interest = mulDivRound(remaining, BigInt(bp), MONTH);
    let part = payment - interest;
    if (i === n || part > remaining) part = remaining;
    if (part < 0n) part = 0n;
    remaining -= part;
    rows.push(row(i, input.firstPaymentDay, part, interest, remaining));
  }
  return rows;
}

function row(
  seq: number,
  first: string,
  principal: bigint,
  interest: bigint,
  remaining: bigint,
): LoanScheduleRow {
  return {
    seq,
    dueDay: sameDayMonthsLater(first, seq - 1),
    instalmentPiastres: Number(principal + interest),
    interestPiastres: Number(interest),
    principalPiastres: Number(principal),
    remainingPiastres: Number(remaining),
  };
}

/** Banks working in Egypt, offered when a loan is recorded (any other bank can be typed). */
export const EGYPT_BANKS: { en: string; ar: string }[] = [
  { en: 'National Bank of Egypt', ar: 'البنك الأهلي المصري' },
  { en: 'Banque Misr', ar: 'بنك مصر' },
  { en: 'CIB', ar: 'البنك التجاري الدولي' },
  { en: 'Banque du Caire', ar: 'بنك القاهرة' },
  { en: 'QNB Egypt', ar: 'بنك قطر الوطني مصر' },
  { en: 'Bank of Alexandria', ar: 'بنك الإسكندرية' },
  { en: 'HSBC Egypt', ar: 'بنك إتش إس بي سي مصر' },
  { en: 'Arab African International Bank', ar: 'البنك العربي الأفريقي الدولي' },
  { en: 'Housing and Development Bank', ar: 'بنك التعمير والإسكان' },
  { en: 'Agricultural Bank of Egypt', ar: 'البنك الزراعي المصري' },
  { en: 'Suez Canal Bank', ar: 'بنك قناة السويس' },
  { en: 'Faisal Islamic Bank of Egypt', ar: 'بنك فيصل الإسلامي المصري' },
  { en: 'Abu Dhabi Islamic Bank Egypt', ar: 'مصرف أبوظبي الإسلامي مصر' },
  { en: 'Emirates NBD Egypt', ar: 'بنك الإمارات دبي الوطني مصر' },
  { en: 'First Abu Dhabi Bank Misr', ar: 'بنك أبوظبي الأول مصر' },
  { en: 'Credit Agricole Egypt', ar: 'بنك كريدي أجريكول مصر' },
  { en: 'Al Baraka Bank Egypt', ar: 'بنك البركة مصر' },
  { en: 'Attijariwafa Bank Egypt', ar: 'بنك التجاري وفا مصر' },
  { en: 'Mashreq Bank Egypt', ar: 'بنك المشرق مصر' },
];

/** A lender's name in the reader's language when it is one of EGYPT_BANKS. */
export function bankName(name: string, locale: string): string {
  const bank = EGYPT_BANKS.find((b) => b.en === name);
  return bank ? (locale === 'ar' ? bank.ar : bank.en) : name;
}

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const day = z.string().refine(isCalendarDay, 'invalid_day');
const piastres = z.number().int().min(1).max(1_000_000_000);

export const loanSchema = z
  .object({
    attachmentIds: attachmentIdsField,
    /** In Egypt companies borrow only from banks (owner, 2026-11-11). */
    lender: z.literal('bank').default('bank'),
    /** The bank's name: one of EGYPT_BANKS (English name) or typed for another bank */
    lenderName: z.string().trim().min(2).max(120),
    principalPiastres: piastres,
    moneyAccountId: id,
    startDay: day,
    annualRateBp: z.number().int().min(0).max(100_000),
    method: z.enum(LOAN_METHODS).default('declining'),
    months: z.number().int().min(1).max(600),
    firstPaymentDay: day,
    reference: z.string().trim().min(2).max(100),
    memo: z.string().trim().max(300).optional(),
    receiptPhotoId: id.optional(),
    idempotencyKey: key,
  })
  .superRefine((v, ctx) => {
    if (v.firstPaymentDay <= v.startDay)
      ctx.addIssue({
        code: 'custom',
        path: ['firstPaymentDay'],
        message: 'first_payment_too_early',
      });
  });
export type LoanBody = z.infer<typeof loanSchema>;

/** Pays the next unpaid instalment of a loan from a bank or cash box. */
export const loanPaymentSchema = z.object({
  attachmentIds: attachmentIdsField,
  moneyAccountId: id,
  reference: z.string().trim().min(2).max(100),
  day: day.optional(),
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

// ─── cost tags ──────────────────────────────────────────────────────────────────

export const costTagSchema = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
});
export const updateCostTagSchema = costTagSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── bank accounts in another currency ─────────────────────────────────────────

/** Currencies a bank account may be held in. The books themselves are always in EGP. */
export const BANK_CURRENCIES = ['EGP', 'USD', 'EUR'] as const;
export type BankCurrency = (typeof BANK_CURRENCIES)[number];

/** EGP for one unit, as text with up to 6 decimals ("48.75"); stored × 1,000,000 */
export const fxRateText = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, 'invalid_rate');

/** Month end revaluation of a bank account in another currency, at the rate entered. */
export const fxRevalueSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month'),
  fxRate: fxRateText,
});
