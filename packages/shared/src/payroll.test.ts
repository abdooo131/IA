import { describe, expect, it } from 'vitest';
import { monthlyPayslip, type PayrollRules, yearlyIncomeTax } from './payroll';

// Law 7 of 2023 bands, in piastres.
const rules: PayrollRules = {
  bands: [
    { to: 4_000_000, bp: 0 },
    { to: 5_500_000, bp: 1000 },
    { to: 7_000_000, bp: 1500 },
    { to: 20_000_000, bp: 2000 },
    { to: 40_000_000, bp: 2250 },
    { to: 120_000_000, bp: 2500 },
  ],
  topBp: 2750,
  skipFrom: [60_000_000, 70_000_000, 80_000_000, 90_000_000, 120_000_000],
  personalExemption: 2_000_000,
  siEmployeeBp: 1100,
  siEmployerBp: 1875,
  siMinWage: 270_000,
  siMaxWage: 1_670_000,
  martyrsBp: 5,
};

describe('salary income tax', () => {
  it('taxes band by band', () => {
    expect(yearlyIncomeTax(0, rules)).toBe(0);
    expect(yearlyIncomeTax(4_000_000, rules)).toBe(0);
    // 15,000 × 10% + 15,000 × 15% + 30,000 × 20% = 9,750 EGP
    expect(yearlyIncomeTax(10_000_000, rules)).toBe(975_000);
  });

  it('takes away the low bands from high earners', () => {
    // 650,000 EGP: the first band (40,000) is taxed at 10% too.
    const normal = 150_000 + 225_000 + 2_600_000 + 4_500_000 + 6_250_000; // up to 650,000 by bands
    expect(yearlyIncomeTax(65_000_000, rules)).toBe(normal + 400_000);
  });
});

describe('monthly payslip', () => {
  it('clamps the insured wage and works out every deduction', () => {
    const slip = monthlyPayslip({ gross: 1_000_000 }, rules);
    expect(slip.insuredWage).toBe(1_000_000);
    expect(slip.siEmployee).toBe(110_000);
    expect(slip.siEmployer).toBe(187_500);
    expect(slip.martyrs).toBe(500);
    // (10,000 − 1,100) × 12 − 20,000 = 86,800 a year → 1,500 + 2,250 + 3,360 = 7,110 tax a year → 592.50 a month
    expect(slip.incomeTax).toBe(59_250);
    expect(slip.afterTax).toBe(1_000_000 - 110_000 - 500 - 59_250);
    expect(monthlyPayslip({ gross: 5_000_000 }, rules).insuredWage).toBe(1_670_000);
    expect(monthlyPayslip({ gross: 200_000 }, rules).insuredWage).toBe(270_000);
  });
});
