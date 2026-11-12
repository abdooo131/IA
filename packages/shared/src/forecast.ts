import { z } from 'zod';

// Forecast (planning): named scenarios of the next 12 Cairo months (migration
// 20261231270000_forecasts). The system suggests drivers from the last complete months of
// the books; people edit the drivers, then may override any profit and loss line of a month.
// forecastCompute turns drivers, overrides and the opening balances into the profit and
// loss, the balance sheet and the cash flow of every month. It is pure and works in whole
// piastres only, so the browser recalculates live while editing and the API computes the
// same numbers.
//
// The model, month by month:
//   orders          the month's own value when one is set, else last month's base grown by
//                   growth_bp; plus every new merchant so far × orders_per_new_merchant
//   fee lines       orders × average fee per order of each fee kind (fee:<kind>), charged
//                   to the merchants' balances with VAT (vat_bp) on top
//   cash orders     orders × cod_share_bp, each collecting cod_per_order for the merchant
//   costs           orders × rider pay, office commission, postal fee and packaging per
//                   order (the postal fee is a share of our fees, read per order); salaries,
//                   rent and fixed amounts per account (fixed:<account id>); depreciation
//                   and loan interest from their schedules
//   merchants owed  what the month added (cash collected − fees − VAT) kept for
//                   merchant_hold_days of the month; the rest is paid out
//   VAT             the month's VAT due (output − input) is paid the next month
//   rider cash      rider_cash_end, else the opening rider cash
//   everything else (other assets and liabilities) stays as it opened
// Level drivers keep their last set value in later months; flow drivers (one off amounts)
// count only in the month they are set.

const pad = (n: number) => String(n).padStart(6, '0');
/** A forecast's number, for example FC-000001 */
export const forecastNumber = (n: number) => `FC-${pad(n)}`;

/** How many months a forecast covers, from the current Cairo month on. */
export const FORECAST_MONTHS = 12;

export const FORECAST_STATUSES = ['draft', 'approved'] as const;
export type ForecastStatusName = (typeof FORECAST_STATUSES)[number];

/** Drivers that keep their last set value in the months after it. */
export const FORECAST_LEVEL_DRIVERS = [
  'growth_bp',
  'orders_per_new_merchant',
  'cod_share_bp',
  'cod_per_order',
  'rider_pay_per_order',
  'office_commission_per_order',
  'postal_per_order',
  'packaging_per_order',
  'salaries',
  'rent',
  'vat_bp',
  'vat_input',
  'merchant_hold_days',
  'rider_cash_end',
] as const;

/** Drivers that count only in the month they are set (orders is special: see above). */
export const FORECAST_FLOW_DRIVERS = [
  'orders',
  'new_merchants',
  'capital_in',
  'drawings',
  'loans_in',
  'loan_principal',
  'loan_interest',
  'capex',
  'depreciation',
] as const;

export type ForecastFixedDriver =
  (typeof FORECAST_LEVEL_DRIVERS)[number] | (typeof FORECAST_FLOW_DRIVERS)[number];

/** Drivers that are counts or basis points; every other driver is an amount in piastres. */
export const FORECAST_COUNT_DRIVERS = new Set<string>([
  'orders',
  'new_merchants',
  'orders_per_new_merchant',
  'merchant_hold_days',
]);
export const FORECAST_BP_DRIVERS = new Set<string>(['growth_bp', 'cod_share_bp', 'vat_bp']);

const FIXED_DRIVERS = new Set<string>([...FORECAST_LEVEL_DRIVERS, ...FORECAST_FLOW_DRIVERS]);
const LEVEL_DRIVERS = new Set<string>(FORECAST_LEVEL_DRIVERS);
const PREFIXED = /^(fee|fixed):[A-Za-z0-9_-]{1,64}$/;

/** A driver key: one of the fixed drivers, fee:<entry kind> or fixed:<account id>. */
export function isForecastDriverKey(key: string) {
  return FIXED_DRIVERS.has(key) || PREFIXED.test(key);
}
const isLevel = (key: string) => LEVEL_DRIVERS.has(key) || PREFIXED.test(key);

/** Profit and loss lines that come from the drivers (besides fee:<kind> and fixed:<id>). */
export const FORECAST_COST_LINES = [
  'rider_pay',
  'office_commission',
  'postal_fee',
  'packaging',
  'salaries',
  'rent',
  'depreciation',
  'loan_interest',
] as const;
export type ForecastCostLine = (typeof FORECAST_COST_LINES)[number];

/** The ledger account (by key) each driver line is budgeted to; fee lines go to fee income. */
export const FORECAST_LINE_ACCOUNT_KEYS: Record<ForecastCostLine | 'fee', string> = {
  fee: 'revenue',
  rider_pay: 'rider_bonus_expense',
  office_commission: 'rider_office_commission',
  postal_fee: 'postal_fee_expense',
  packaging: 'expense:packaging',
  salaries: 'expense:salaries',
  rent: 'expense:rent',
  depreciation: 'depreciation_expense',
  loan_interest: 'loan_interest_expense',
};

const COST_LINES = new Set<string>(FORECAST_COST_LINES);
/** A profit and loss line key: a cost line, fee:<kind> or fixed:<account id>. */
export function isForecastLineKey(key: string) {
  return COST_LINES.has(key) || PREFIXED.test(key);
}

/** Largest driver or override value accepted (the database columns are 32 bit integers). */
export const FORECAST_MAX_VALUE = 2_000_000_000;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const month = z.string().regex(MONTH);
const value = z.number().int().min(-FORECAST_MAX_VALUE).max(FORECAST_MAX_VALUE);

export const createForecastSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Copy this scenario instead of starting from the system's suggestion */
  copyFromId: z.string().min(1).max(64).optional(),
});
export const renameForecastSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const forecastDriversSchema = z.object({
  changes: z
    .array(
      z.object({
        month,
        key: z.string().refine(isForecastDriverKey, 'invalid_driver'),
        /** null removes the month's value (a level driver then keeps the earlier one) */
        value: value.nullable(),
      }),
    )
    .min(1)
    .max(2000),
});
export const forecastOverridesSchema = z.object({
  changes: z
    .array(
      z.object({
        month,
        lineKey: z.string().refine(isForecastLineKey, 'invalid_line'),
        /** null removes the override: the line is computed again */
        amountPiastres: value.nullable(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export const forecastToBudgetSchema = z.object({ mode: z.enum(['replace', 'skip']) });

// ─── months ──────────────────────────────────────────────────────────────────

/** YYYY-MM plus n months. */
export function forecastAddMonths(m: string, n: number) {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const i = y * 12 + (mm - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** The months of a forecast starting at `start`. */
export function forecastMonths(start: string, count = FORECAST_MONTHS) {
  return Array.from({ length: count }, (_, i) => forecastAddMonths(start, i));
}

export function daysInMonth(m: string) {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mm, 0)).getUTCDate();
}

/** a × b ÷ c rounded half away from zero, in whole numbers (c > 0). */
export function mulDiv(a: number, b: number, c: number) {
  const p = a * b;
  const q = Math.floor((Math.abs(p) + Math.floor(c / 2)) / c);
  return p < 0 ? -q : q;
}

// ─── compute ─────────────────────────────────────────────────────────────────

export interface ForecastDriverRow {
  month: string;
  key: string;
  value: number;
}
export interface ForecastOverrideRow {
  month: string;
  lineKey: string;
  amountPiastres: number;
}

/** Balances at the start of the first month; liabilities and equity as positive amounts. */
export interface ForecastOpening {
  /** Banks and cash boxes (store boxes included) */
  cash: number;
  riderCash: number;
  /** Equipment less accumulated depreciation */
  fixedAssets: number;
  otherAssets: number;
  /** What we owe merchants (negative when they owe us) */
  merchants: number;
  vatPayable: number;
  loans: number;
  otherLiabilities: number;
  /** Capital, drawings and opening balances */
  capital: number;
  /** Retained earnings plus this year's profit so far */
  retainedEarnings: number;
}

export const EMPTY_OPENING: ForecastOpening = {
  cash: 0,
  riderCash: 0,
  fixedAssets: 0,
  otherAssets: 0,
  merchants: 0,
  vatPayable: 0,
  loans: 0,
  otherLiabilities: 0,
  capital: 0,
  retainedEarnings: 0,
};

/** Accounts that fixed:<id> lines name, with their category. */
export interface ForecastAccountRef {
  id: string;
  category: 'revenue' | 'expense';
}

export interface ForecastInput {
  startMonth: string;
  months?: number;
  drivers: ForecastDriverRow[];
  overrides: ForecastOverrideRow[];
  opening: ForecastOpening;
  accounts: ForecastAccountRef[];
}

export interface ForecastLine {
  key: string;
  category: 'revenue' | 'expense';
}

export interface ForecastBalanceSheet {
  cash: number;
  riderCash: number;
  fixedAssets: number;
  otherAssets: number;
  totalAssets: number;
  merchants: number;
  vatPayable: number;
  loans: number;
  otherLiabilities: number;
  totalLiabilities: number;
  capital: number;
  retainedEarnings: number;
  totalEquity: number;
}

export interface ForecastCashFlow {
  profit: number;
  depreciation: number;
  merchantsChange: number;
  vatChange: number;
  riderCashChange: number;
  operating: number;
  capex: number;
  investing: number;
  loansIn: number;
  loanRepayments: number;
  capitalIn: number;
  drawings: number;
  financing: number;
  netChange: number;
  cashStart: number;
  cashEnd: number;
}

export interface ForecastMonthResult {
  month: string;
  orders: number;
  codOrders: number;
  codCollected: number;
  /** Each line's amount (revenue and costs both positive) */
  lines: Record<string, number>;
  /** Lines of this month set by hand (an override) */
  edited: string[];
  revenue: number;
  expenses: number;
  profit: number;
  feeIncome: number;
  vatOutput: number;
  vatInput: number;
  vatPaid: number;
  merchantPayouts: number;
  balanceSheet: ForecastBalanceSheet;
  cashFlow: ForecastCashFlow;
}

export type ForecastWarningCode = 'cash_below_zero' | 'loans_below_zero' | 'merchants_owe_us';
export interface ForecastWarning {
  month: string;
  code: ForecastWarningCode;
  amount: number;
}

export interface ForecastResult {
  months: ForecastMonthResult[];
  lines: ForecastLine[];
  warnings: ForecastWarning[];
}

/** Profit and loss, balance sheet and cash flow of every month (see the model above). */
export function forecastCompute(input: ForecastInput): ForecastResult {
  const months = forecastMonths(input.startMonth, input.months ?? FORECAST_MONTHS);
  const set = new Map<string, number>();
  for (const d of input.drivers) set.set(`${d.month}|${d.key}`, d.value);
  const overrides = new Map<string, number>();
  for (const o of input.overrides) overrides.set(`${o.month}|${o.lineKey}`, o.amountPiastres);
  const accounts = new Map(input.accounts.map((a) => [a.id, a.category]));

  // Keys named anywhere, so a line shows even in months where it is zero.
  const feeKinds = new Set<string>();
  const fixedIds = new Set<string>();
  const note = (key: string) => {
    if (key.startsWith('fee:')) feeKinds.add(key.slice(4));
    else if (key.startsWith('fixed:') && accounts.has(key.slice(6))) fixedIds.add(key.slice(6));
  };
  input.drivers.forEach((d) => note(d.key));
  input.overrides.forEach((o) => note(o.lineKey));

  const lines: ForecastLine[] = [
    ...[...feeKinds].sort().map((k) => ({ key: `fee:${k}`, category: 'revenue' as const })),
    ...[...fixedIds]
      .filter((id) => accounts.get(id) === 'revenue')
      .sort()
      .map((id) => ({ key: `fixed:${id}`, category: 'revenue' as const })),
    ...FORECAST_COST_LINES.map((key) => ({ key, category: 'expense' as const })),
    ...[...fixedIds]
      .filter((id) => accounts.get(id) === 'expense')
      .sort()
      .map((id) => ({ key: `fixed:${id}`, category: 'expense' as const })),
  ];

  /** A level driver: the latest value set at or before the month. */
  const level = (key: string, i: number, fallback = 0) => {
    for (let j = i; j >= 0; j--) {
      const v = set.get(`${months[j]}|${key}`);
      if (v !== undefined) return v;
    }
    return fallback;
  };
  const flow = (key: string, i: number) => set.get(`${months[i]}|${key}`) ?? 0;
  const driver = (key: string, i: number, fallback = 0) =>
    isLevel(key) ? level(key, i, fallback) : flow(key, i);

  const o = input.opening;
  let base = 0;
  let newMerchants = 0;
  let cash = o.cash;
  let riderCash = o.riderCash;
  let fixedAssets = o.fixedAssets;
  let merchants = o.merchants;
  let vatPayable = o.vatPayable;
  let loans = o.loans;
  let capital = o.capital;
  let retained = o.retainedEarnings;

  const out: ForecastMonthResult[] = [];
  const warnings: ForecastWarning[] = [];
  months.forEach((m, i) => {
    const explicit = set.get(`${m}|orders`);
    if (explicit !== undefined) base = explicit;
    else if (i > 0) base = mulDiv(base, 10_000 + driver('growth_bp', i), 10_000);
    newMerchants += driver('new_merchants', i);
    const orders = Math.max(0, base + newMerchants * driver('orders_per_new_merchant', i));
    const codOrders = mulDiv(orders, driver('cod_share_bp', i), 10_000);
    const codCollected = codOrders * driver('cod_per_order', i);

    const computed: Record<string, number> = {};
    for (const k of feeKinds) computed[`fee:${k}`] = orders * driver(`fee:${k}`, i);
    for (const id of fixedIds) computed[`fixed:${id}`] = driver(`fixed:${id}`, i);
    computed.rider_pay = orders * driver('rider_pay_per_order', i);
    computed.office_commission = orders * driver('office_commission_per_order', i);
    computed.postal_fee = orders * driver('postal_per_order', i);
    computed.packaging = orders * driver('packaging_per_order', i);
    computed.salaries = driver('salaries', i);
    computed.rent = driver('rent', i);
    computed.depreciation = driver('depreciation', i);
    computed.loan_interest = driver('loan_interest', i);

    const amounts: Record<string, number> = {};
    const edited: string[] = [];
    let revenue = 0;
    let expenses = 0;
    let feeIncome = 0;
    for (const line of lines) {
      const over = overrides.get(`${m}|${line.key}`);
      const amount = over ?? computed[line.key] ?? 0;
      if (over !== undefined) edited.push(line.key);
      amounts[line.key] = amount;
      if (line.category === 'revenue') revenue += amount;
      else expenses += amount;
      if (line.key.startsWith('fee:')) feeIncome += amount;
    }
    const profit = revenue - expenses;
    const depreciation = amounts.depreciation ?? 0;

    // VAT: this month's due is paid next month; a credit is carried, never paid back.
    const vatOutput = mulDiv(feeIncome, driver('vat_bp', i), 10_000);
    const vatInput = driver('vat_input', i);
    const vatPaid = Math.max(0, vatPayable);
    const vatEnd = vatPayable - vatPaid + vatOutput - vatInput;

    // Merchants: cash collected for them less our fees and VAT, part kept until payout.
    const netToMerchants = codCollected - feeIncome - vatOutput;
    const merchantsEnd = mulDiv(netToMerchants, driver('merchant_hold_days', i), daysInMonth(m));
    const merchantPayouts = merchants + netToMerchants - merchantsEnd;

    const riderEnd = driver('rider_cash_end', i, o.riderCash);
    const capex = driver('capex', i);
    const loansIn = driver('loans_in', i);
    const loanRepayments = driver('loan_principal', i);
    const capitalIn = driver('capital_in', i);
    const drawings = driver('drawings', i);

    const merchantsChange = merchantsEnd - merchants;
    const vatChange = vatEnd - vatPayable;
    const riderCashChange = riderEnd - riderCash;
    const operating = profit + depreciation + merchantsChange + vatChange - riderCashChange;
    const investing = -capex;
    const financing = loansIn - loanRepayments + capitalIn - drawings;
    const netChange = operating + investing + financing;
    const cashStart = cash;

    cash += netChange;
    riderCash = riderEnd;
    fixedAssets += capex - depreciation;
    merchants = merchantsEnd;
    vatPayable = vatEnd;
    loans += loansIn - loanRepayments;
    capital += capitalIn - drawings;
    retained += profit;

    const totalAssets = cash + riderCash + fixedAssets + o.otherAssets;
    const totalLiabilities = merchants + vatPayable + loans + o.otherLiabilities;
    out.push({
      month: m,
      orders,
      codOrders,
      codCollected,
      lines: amounts,
      edited,
      revenue,
      expenses,
      profit,
      feeIncome,
      vatOutput,
      vatInput,
      vatPaid,
      merchantPayouts,
      balanceSheet: {
        cash,
        riderCash,
        fixedAssets,
        otherAssets: o.otherAssets,
        totalAssets,
        merchants,
        vatPayable,
        loans,
        otherLiabilities: o.otherLiabilities,
        totalLiabilities,
        capital,
        retainedEarnings: retained,
        totalEquity: capital + retained,
      },
      cashFlow: {
        profit,
        depreciation,
        merchantsChange,
        vatChange,
        riderCashChange,
        operating,
        capex,
        investing,
        loansIn,
        loanRepayments,
        capitalIn,
        drawings,
        financing,
        netChange,
        cashStart,
        cashEnd: cash,
      },
    });
    if (cash < 0) warnings.push({ month: m, code: 'cash_below_zero', amount: cash });
    if (loans < 0) warnings.push({ month: m, code: 'loans_below_zero', amount: loans });
    if (merchants < 0) warnings.push({ month: m, code: 'merchants_owe_us', amount: -merchants });
  });
  return { months: out, lines, warnings };
}

// ─── periods ─────────────────────────────────────────────────────────────────

export interface ForecastPeriod {
  /** m:<YYYY-MM>, q1 to q4 (three months each from the first month) or year */
  key: string;
  months: string[];
}

/** Each month, then the forecast's quarters (Q1 is its first three months) and the year. */
export function forecastPeriods(months: string[]): ForecastPeriod[] {
  const quarters: ForecastPeriod[] = [];
  for (let q = 0; q * 3 < months.length; q++)
    quarters.push({ key: `q${q + 1}`, months: months.slice(q * 3, q * 3 + 3) });
  return [
    ...months.map((m) => ({ key: `m:${m}`, months: [m] })),
    ...quarters,
    { key: 'year', months },
  ];
}

export interface ForecastPeriodTotals {
  key: string;
  months: string[];
  orders: number;
  codCollected: number;
  lines: Record<string, number>;
  /** Lines set by hand in any month of the period */
  edited: string[];
  revenue: number;
  expenses: number;
  profit: number;
  /** Flows add up over the period */
  cashFlow: ForecastCashFlow;
  /** The balance sheet at the end of the period's last month */
  balanceSheet: ForecastBalanceSheet;
}

/** A period's totals: flows summed, balances as at its last month. */
export function forecastPeriodTotals(
  result: ForecastResult,
  period: ForecastPeriod,
): ForecastPeriodTotals {
  const rows = result.months.filter((r) => period.months.includes(r.month));
  const sum = (f: (r: ForecastMonthResult) => number) => rows.reduce((s, r) => s + f(r), 0);
  const lines: Record<string, number> = {};
  for (const l of result.lines) lines[l.key] = sum((r) => r.lines[l.key] ?? 0);
  const flowKeys = Object.keys(rows[0]?.cashFlow ?? {}) as (keyof ForecastCashFlow)[];
  const cashFlow = Object.fromEntries(
    flowKeys.map((k) => [k, sum((r) => r.cashFlow[k])]),
  ) as unknown as ForecastCashFlow;
  if (rows.length) {
    cashFlow.cashStart = rows[0]!.cashFlow.cashStart;
    cashFlow.cashEnd = rows[rows.length - 1]!.cashFlow.cashEnd;
  }
  return {
    key: period.key,
    months: period.months,
    orders: sum((r) => r.orders),
    codCollected: sum((r) => r.codCollected),
    lines,
    edited: [...new Set(rows.flatMap((r) => r.edited))],
    revenue: sum((r) => r.revenue),
    expenses: sum((r) => r.expenses),
    profit: sum((r) => r.profit),
    cashFlow,
    balanceSheet: rows[rows.length - 1]!.balanceSheet,
  };
}

/**
 * What a forecast puts into the budget: each income and expense line of each month added
 * up per ledger account. `accountFor` names the account of a line (null: no account yet).
 */
export function forecastBudgetRows(
  result: ForecastResult,
  accountFor: (lineKey: string) => string | null,
) {
  const rows = new Map<string, { month: string; accountId: string; amountPiastres: number }>();
  for (const m of result.months)
    for (const line of result.lines) {
      const accountId = accountFor(line.key);
      if (!accountId) continue;
      const k = `${m.month}|${accountId}`;
      const row = rows.get(k) ?? { month: m.month, accountId, amountPiastres: 0 };
      row.amountPiastres += m.lines[line.key] ?? 0;
      rows.set(k, row);
    }
  return [...rows.values()];
}

/** The ledger account key a driver line is budgeted to, or the account id of fixed:<id>. */
export function forecastLineAccount(lineKey: string): { key: string } | { id: string } | null {
  if (lineKey.startsWith('fee:')) return { key: FORECAST_LINE_ACCOUNT_KEYS.fee };
  if (lineKey.startsWith('fixed:')) return { id: lineKey.slice(6) };
  if (COST_LINES.has(lineKey))
    return { key: FORECAST_LINE_ACCOUNT_KEYS[lineKey as ForecastCostLine] };
  return null;
}
