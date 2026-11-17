// Egyptian salary deductions, worked out from settings (the law changes; the numbers live in
// the settings table). Everything is in piastres and integer arithmetic.
//
//   gross ─┬─ social insurance (employee share of the insured wage, clamped to min..max)
//          ├─ martyrs fund (a small share of gross)
//          └─ income tax: (gross − employee insurance) × 12 − personal exemption, taxed by
//             yearly bands, then divided by 12 for the month

export interface PayrollRules {
  /** Upper limits of the bands (yearly piastres), lowest first; the top rate applies above the last */
  bands: { to: number; bp: number }[];
  topBp: number;
  /** Above each threshold, the first k bands are taxed at the rate of band k + 1 (0 = off) */
  skipFrom: number[];
  personalExemption: number;
  siEmployeeBp: number;
  siEmployerBp: number;
  siMinWage: number;
  siMaxWage: number;
  martyrsBp: number;
}

const share = (amount: number, bp: number) => Math.floor((amount * bp + 5_000) / 10_000);

/** Yearly income tax on yearly taxable income (after the exemption). */
export function yearlyIncomeTax(taxable: number, rules: PayrollRules): number {
  if (taxable <= 0) return 0;
  const rates = rules.bands.map((b) => b.bp);
  // High earners lose the low bands: they are taxed at a higher band's rate.
  let skipped = 0;
  rules.skipFrom.forEach((from, k) => {
    if (from > 0 && taxable > from) skipped = k + 1;
  });
  for (let i = 0; i < skipped && i < rates.length; i++) rates[i] = rates[skipped] ?? rules.topBp;
  let tax = 0;
  let lower = 0;
  for (const [i, band] of rules.bands.entries()) {
    if (taxable <= lower) break;
    tax += share(Math.min(taxable, band.to) - lower, rates[i]!);
    lower = band.to;
  }
  if (taxable > lower) tax += share(taxable - lower, rules.topBp);
  return tax;
}

export interface PayslipLine {
  gross: number;
  insuredWage: number;
  siEmployee: number;
  siEmployer: number;
  martyrs: number;
  incomeTax: number;
  /** Gross minus the employee's insurance, tax and martyrs fund (before deductions and advances) */
  afterTax: number;
}

/** One month's deductions for one employee. */
export function monthlyPayslip(
  input: { gross: number; insuredWage?: number | null },
  rules: PayrollRules,
): PayslipLine {
  const insured = Math.min(
    Math.max(input.insuredWage ?? input.gross, rules.siMinWage),
    rules.siMaxWage,
  );
  const siEmployee = input.gross > 0 ? share(insured, rules.siEmployeeBp) : 0;
  const siEmployer = input.gross > 0 ? share(insured, rules.siEmployerBp) : 0;
  const martyrs = share(input.gross, rules.martyrsBp);
  const yearly = (input.gross - siEmployee) * 12 - rules.personalExemption;
  const incomeTax = Math.floor((yearlyIncomeTax(yearly, rules) + 6) / 12);
  return {
    gross: input.gross,
    insuredWage: insured,
    siEmployee,
    siEmployer,
    martyrs,
    incomeTax,
    afterTax: input.gross - siEmployee - martyrs - incomeTax,
  };
}
