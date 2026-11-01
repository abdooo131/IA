import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceOf,
  createSupplier,
  ensureDefaultAccounts,
  giveAdvance,
  payBill,
  payslips,
  payStaffBonus,
  payTax,
  recordBill,
  recordCapital,
  runPayroll,
  setEmployment,
  setSalary,
  taxesOwed,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `st-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const person = (email: string, name: string) =>
  prisma.user.create({
    data: { email, name, role: 'store_staff', passwordHash: 'x', darkStoreId: f.store.id },
  });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 50_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('employees: taxes and social insurance', () => {
  it('takes income tax, insurance and the martyrs fund off each salary and pays them later', async () => {
    const cib = await byKey('bank');
    const manager = await person('m@t.eg', 'Mona');
    await setSalary(prisma, {
      userId: manager.id,
      monthlyPiastres: 2_000_000,
      insuredWagePiastres: 1_200_000,
      actorUserId: admin,
    });
    const month = addDays(cairoDay(new Date()), -35).slice(0, 7);
    await runPayroll(prisma, {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: manager.id, bonusPiastres: 100_000 }],
      actorUserId: admin,
    });
    const [slip] = (await payslips(prisma, month)).people;
    // 21,000 gross; insurance on the 12,000 insured wage: 1,320 employee, 2,250 company.
    expect(slip).toMatchObject({
      gross: 2_100_000,
      bonus: 100_000,
      siEmployee: 132_000,
      siEmployer: 225_000,
      martyrs: 1_050,
    });
    // (21,000 − 1,320) × 12 − 20,000 = 216,160 a year → 1,500 + 2,250 + 26,000 + 3,636 =
    // 33,386 a year → 2,782.17 a month.
    expect(slip!.incomeTax).toBe(278_217);
    expect(slip!.net).toBe(2_100_000 - 132_000 - 1_050 - 278_217);
    const owed = await taxesOwed(prisma);
    expect(owed).toMatchObject({
      payrollTaxPiastres: 278_217,
      socialInsurancePiastres: 357_000,
      martyrsFundPiastres: 1_050,
    });
    // The company's cost is the gross plus its insurance share.
    expect(await balanceOf(prisma, { type: 'social_insurance_expense' })).toBe(225_000);
    await payTax(prisma, {
      tax: 'social_insurance',
      amountPiastres: 357_000,
      moneyAccountId: cib.id,
      reference: 'Insurance office',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect((await taxesOwed(prisma)).socialInsurancePiastres).toBe(0);
  });
});

describe('outsourced people', () => {
  it('bills each person through their company, recovers advances and pays bonuses directly', async () => {
    const cib = await byKey('bank');
    const agency = await createSupplier(prisma, {
      name: 'Cairo Manpower',
      taxId: '555-111-222',
      whtBp: 300,
      defaultExpenseAccountId: (await byKey('expense:salaries')).id,
      actorUserId: admin,
    });
    const other = await createSupplier(prisma, { name: 'Other agency', actorUserId: admin });
    const picker = await person('p@t.eg', 'Hany');
    await setEmployment(prisma, {
      userId: picker.id,
      employment: 'outsourced',
      staffingSupplierId: agency.id,
      actorUserId: admin,
    });
    await expect(
      setSalary(prisma, { userId: picker.id, monthlyPiastres: 1, actorUserId: admin }),
    ).rejects.toThrow('outsourced_not_on_payroll');
    await expect(
      runPayroll(prisma, {
        month: '2026-01',
        moneyAccountId: cib.id,
        lines: [{ userId: picker.id, grossPiastres: 100 }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('outsourced_not_on_payroll');

    await giveAdvance(prisma, {
      userId: picker.id,
      amountPiastres: 50_000,
      moneyAccountId: cib.id,
      reference: 'Advance',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payStaffBonus(prisma, {
      userId: picker.id,
      amountPiastres: 20_000,
      moneyAccountId: cib.id,
      reference: 'Top picker',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // Only their own company bills their month.
    await expect(
      recordBill(prisma, {
        supplierId: other.id,
        reference: 'X',
        billDate: cairoDay(new Date()),
        dueDate: cairoDay(new Date()),
        expenseAccountId: (await byKey('expense:salaries')).id,
        userId: picker.id,
        netPiastres: 100,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('not_their_company');
    const day = cairoDay(new Date());
    const bill = await recordBill(prisma, {
      supplierId: agency.id,
      reference: 'INV-9',
      billDate: day,
      dueDate: day,
      userId: picker.id,
      netPiastres: 700_000,
      vatPiastres: 98_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(bill).toMatchObject({ userId: picker.id, darkStoreId: f.store.id });
    const before = await balanceOf(prisma, { id: cib.id });
    await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 798_000,
      moneyAccountId: cib.id,
      reference: 'T1',
      advanceRecoveryPiastres: 50_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // 3% withholding on 7,000 = 210; the 500 advance is taken back from the company.
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - (798_000 - 21_000 - 50_000));
    expect(await balanceOf(prisma, { type: 'staff_advance', userId: picker.id })).toBe(0);
    // The person's cost shows on them and their store: their month and the bonus.
    const lines = await prisma.ledgerLine.findMany({
      where: { userId: picker.id, account: { category: 'expense' } },
    });
    expect(lines.reduce((s, l) => s + l.amountPiastres, 0)).toBe(720_000);
    expect(lines.every((l) => l.darkStoreId === f.store.id)).toBe(true);
  });

  it('refuses a direct bonus to an employee', async () => {
    const employee = await person('e@t.eg', 'Emad');
    await expect(
      payStaffBonus(prisma, {
        userId: employee.id,
        amountPiastres: 100,
        moneyAccountId: (await byKey('bank')).id,
        reference: 'Bonus',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('employee_bonus_in_payroll');
  });
});
