import { describe, expect, it } from 'vitest';
import {
  EMPTY_OPENING,
  type ForecastInput,
  forecastBudgetRows,
  forecastCompute,
  forecastDriversSchema,
  forecastMonths,
  forecastPeriodTotals,
  forecastPeriods,
  isForecastDriverKey,
  mulDiv,
} from './forecast';

const start = '2026-11';
const months = forecastMonths(start);

/** A balanced opening: assets 1,000,000 = liabilities 600,000 + equity 400,000. */
const opening = {
  cash: 500_000,
  riderCash: 100_000,
  fixedAssets: 300_000,
  otherAssets: 100_000,
  merchants: 250_000,
  vatPayable: 50_000,
  loans: 200_000,
  otherLiabilities: 100_000,
  capital: 300_000,
  retainedEarnings: 100_000,
};

const base = (): ForecastInput => ({
  startMonth: start,
  opening,
  accounts: [
    { id: 'acct_office', category: 'expense' },
    { id: 'acct_other_income', category: 'revenue' },
  ],
  overrides: [],
  drivers: [
    { month: start, key: 'orders', value: 1_000 },
    { month: start, key: 'growth_bp', value: 333 },
    { month: start, key: 'fee:order_fee', value: 1_999 },
    { month: start, key: 'fee:cod_fee', value: 377 },
    { month: start, key: 'cod_share_bp', value: 6_667 },
    { month: start, key: 'cod_per_order', value: 45_013 },
    { month: start, key: 'rider_pay_per_order', value: 1_501 },
    { month: start, key: 'office_commission_per_order', value: 151 },
    { month: start, key: 'packaging_per_order', value: 303 },
    { month: start, key: 'salaries', value: 1_500_000 },
    { month: start, key: 'rent', value: 400_000 },
    { month: start, key: 'fixed:acct_office', value: 77_777 },
    { month: start, key: 'fixed:acct_other_income', value: 12_345 },
    { month: start, key: 'vat_bp', value: 1_400 },
    { month: start, key: 'vat_input', value: 9_999 },
    { month: start, key: 'merchant_hold_days', value: 7 },
    { month: months[2]!, key: 'rider_cash_end', value: 333_333 },
    { month: months[1]!, key: 'new_merchants', value: 3 },
    { month: start, key: 'orders_per_new_merchant', value: 41 },
    { month: months[3]!, key: 'capex', value: 900_000 },
    { month: months[4]!, key: 'loans_in', value: 5_000_000 },
    { month: months[5]!, key: 'loan_principal', value: 123_457 },
    { month: months[5]!, key: 'loan_interest', value: 45_678 },
    { month: months[6]!, key: 'capital_in', value: 1_000_000 },
    { month: months[7]!, key: 'drawings', value: 250_001 },
    ...months.map((m) => ({ month: m, key: 'depreciation', value: 8_333 })),
  ],
});

describe('forecastCompute', () => {
  it('keeps the balance sheet balanced every month and the cash flow tied to cash', () => {
    for (const overrides of [
      [],
      [
        { month: months[2]!, lineKey: 'rent', amountPiastres: 650_001 },
        { month: months[4]!, lineKey: 'fee:order_fee', amountPiastres: 3 },
        { month: months[5]!, lineKey: 'depreciation', amountPiastres: 99_999 },
      ],
    ]) {
      const r = forecastCompute({ ...base(), overrides });
      let cash = opening.cash;
      for (const m of r.months) {
        const b = m.balanceSheet;
        expect(b.totalAssets).toBe(b.totalLiabilities + b.totalEquity);
        expect(m.cashFlow.cashStart).toBe(cash);
        expect(m.cashFlow.cashEnd).toBe(b.cash);
        expect(m.cashFlow.netChange).toBe(b.cash - cash);
        expect(m.cashFlow.operating + m.cashFlow.investing + m.cashFlow.financing).toBe(
          m.cashFlow.netChange,
        );
        expect(m.profit).toBe(m.revenue - m.expenses);
        for (const v of [b.cash, m.profit, m.vatOutput, m.merchantPayouts])
          expect(Number.isInteger(v)).toBe(true);
        cash = b.cash;
      }
    }
  });

  it('grows orders, adds new merchants and carries level drivers forward', () => {
    const r = forecastCompute(base());
    expect(r.months[0]!.orders).toBe(1_000);
    // 1,000 × 1.0333 = 1,033.3 → 1,033, plus 3 new merchants × 41
    expect(r.months[1]!.orders).toBe(1_033 + 123);
    expect(r.months[0]!.lines['fee:order_fee']).toBe(1_999_000);
    expect(r.months[3]!.lines.rent).toBe(400_000);
    // Cash orders: 1,000 × 66.67% = 666.7 → 667
    expect(r.months[0]!.codOrders).toBe(667);
    expect(r.months[0]!.balanceSheet.riderCash).toBe(100_000);
    expect(r.months[2]!.balanceSheet.riderCash).toBe(333_333);
    expect(r.months[11]!.balanceSheet.riderCash).toBe(333_333);
    // Flows only count in their month
    expect(r.months[3]!.cashFlow.capex).toBe(900_000);
    expect(r.months[4]!.cashFlow.capex).toBe(0);
    expect(r.months[5]!.balanceSheet.loans).toBe(200_000 + 5_000_000 - 123_457);
  });

  it('lets an override win over the computed line and marks it edited', () => {
    const overrides = [{ month: months[1]!, lineKey: 'salaries', amountPiastres: 7 }];
    const r = forecastCompute({ ...base(), overrides });
    expect(r.months[1]!.lines.salaries).toBe(7);
    expect(r.months[1]!.edited).toEqual(['salaries']);
    expect(r.months[2]!.lines.salaries).toBe(1_500_000);
    expect(r.months[2]!.edited).toEqual([]);
    const plain = forecastCompute(base());
    expect(r.months[1]!.profit - plain.months[1]!.profit).toBe(1_500_000 - 7);
  });

  it('rounds VAT and merchant holds half away from zero', () => {
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
    expect(mulDiv(1_033_333, 1_400, 10_000)).toBe(144_667);
    const r = forecastCompute(base());
    const m = r.months[0]!;
    expect(m.vatOutput).toBe(mulDiv(m.feeIncome, 1_400, 10_000));
    // The opening VAT is paid in the first month, the month's own VAT the next.
    expect(m.vatPaid).toBe(50_000);
    expect(r.months[1]!.vatPaid).toBe(m.vatOutput - m.vatInput);
  });

  it('starts at zero with nothing and warns when cash goes below zero', () => {
    const empty = forecastCompute({
      startMonth: start,
      opening: EMPTY_OPENING,
      accounts: [],
      overrides: [],
      drivers: [],
    });
    expect(empty.months).toHaveLength(12);
    expect(empty.months.every((m) => m.profit === 0 && m.balanceSheet.cash === 0)).toBe(true);
    expect(empty.warnings).toEqual([]);
    const poor = forecastCompute({
      startMonth: start,
      opening: EMPTY_OPENING,
      accounts: [],
      overrides: [],
      drivers: [{ month: months[2]!, key: 'rent', value: 100 }],
    });
    expect(poor.warnings[0]).toEqual({ month: months[2], code: 'cash_below_zero', amount: -100 });
  });

  it('totals quarters and the year, balances at the period end', () => {
    const r = forecastCompute(base());
    const periods = forecastPeriods(months);
    expect(periods.map((p) => p.key).slice(12)).toEqual(['q1', 'q2', 'q3', 'q4', 'year']);
    const year = forecastPeriodTotals(
      r,
      periods.find((p) => p.key === 'year')!,
    );
    expect(year.profit).toBe(r.months.reduce((s, m) => s + m.profit, 0));
    expect(year.balanceSheet).toEqual(r.months[11]!.balanceSheet);
    expect(year.cashFlow.cashStart).toBe(opening.cash);
    expect(year.cashFlow.cashEnd).toBe(r.months[11]!.balanceSheet.cash);
    const q2 = forecastPeriodTotals(
      r,
      periods.find((p) => p.key === 'q2')!,
    );
    expect(q2.months).toEqual(months.slice(3, 6));
  });

  it('adds lines up per account for the budget', () => {
    const r = forecastCompute(base());
    const rows = forecastBudgetRows(r, (k) => (k.startsWith('fee:') ? 'fees' : null));
    expect(rows).toHaveLength(12);
    expect(rows[0]!.amountPiastres).toBe(r.months[0]!.feeIncome);
  });

  it('checks driver keys', () => {
    expect(isForecastDriverKey('fee:order_fee')).toBe(true);
    expect(isForecastDriverKey('fixed:cm1abc')).toBe(true);
    expect(isForecastDriverKey('bogus')).toBe(false);
    expect(
      forecastDriversSchema.safeParse({ changes: [{ month: start, key: 'x', value: 1 }] }).success,
    ).toBe(false);
    expect(
      forecastDriversSchema.safeParse({ changes: [{ month: start, key: 'rent', value: 1.5 }] })
        .success,
    ).toBe(false);
  });
});
