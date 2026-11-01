import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  bookCorporateTax,
  closeYear,
  comparativeStatements,
  corporateTaxEstimate,
  createSupplier,
  ensureDefaultAccounts,
  payBill,
  payrollForms,
  post,
  recordBill,
  recordCapital,
  runPayroll,
  setSalary,
  vatReturn,
  withholdingPayments,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `ret-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const lastMonth = () => addMonths(cairoDay(new Date()).slice(0, 7), -1);
const inLastMonth = () => new Date(cairoDayStart(`${lastMonth()}-10`).getTime() + 3600_000);

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
    amountPiastres: 10_000_000,
    reference: 'Owner',
    day: addDays(`${lastMonth()}-01`, 0),
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('VAT return', () => {
  it('adds sales VAT, takes off VAT claimed back and carries a credit', async () => {
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: inLastMonth(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 114_000 },
        { account: { type: 'revenue' }, amount: -100_000 },
        { account: { type: 'vat_payable' }, amount: -14_000 },
      ],
    });
    await post(prisma, {
      kind: 'expense',
      idempotencyKey: key(),
      occurredAt: inLastMonth(),
      lines: [
        { account: { id: (await byKey('expense:rent')).id }, amount: 50_000 },
        { account: { type: 'vat_payable' }, amount: 7_000 },
        { account: { type: 'bank' }, amount: -57_000 },
      ],
    });
    const ret = await vatReturn(prisma, lastMonth());
    expect(ret).toMatchObject({
      salesPiastres: 100_000,
      outputVatPiastres: 14_000,
      purchasesPiastres: 50_000,
      inputVatPiastres: 7_000,
      duePiastres: 7_000,
      carriedOutPiastres: 0,
    });
  });
});

describe('withholding and payroll forms', () => {
  it('lists each payment that kept withholding tax, and each employee of the run', async () => {
    const cib = await byKey('bank');
    const supplier = await createSupplier(prisma, {
      name: 'Fix it',
      taxId: '111222333',
      whtBp: 300,
      defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
      actorUserId: admin,
    });
    const day = cairoDay(new Date());
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'F1',
      billDate: day,
      dueDate: day,
      netPiastres: 100_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 100_000,
      moneyAccountId: cib.id,
      reference: 'T',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const rows = await withholdingPayments(prisma, {
      year: Number(day.slice(0, 4)),
      quarter: Math.ceil(Number(day.slice(5, 7)) / 3),
    });
    expect(rows[0]).toMatchObject({ taxId: '111222333', rateBp: 300, whtPiastres: 3_000 });

    const staff = await prisma.user.create({
      data: { email: 's@t.eg', name: 'Sara', role: 'store_staff', passwordHash: 'x' },
    });
    await expect(
      setSalary(prisma, {
        userId: staff.id,
        monthlyPiastres: 600_000,
        nationalId: '123',
        actorUserId: admin,
      }),
    ).rejects.toThrow('invalid_national_id');
    await setSalary(prisma, {
      userId: staff.id,
      monthlyPiastres: 600_000,
      nationalId: '29001011234567',
      insuranceNumber: 'SI-77',
      actorUserId: admin,
    });
    await runPayroll(prisma, {
      month: lastMonth(),
      moneyAccountId: cib.id,
      lines: [{ userId: staff.id }],
      actorUserId: admin,
    });
    const forms = await payrollForms(prisma, lastMonth());
    expect(forms.rows[0]).toMatchObject({ nationalId: '29001011234567', siEmployee: 66_000 });
    expect(forms.missingIds).toBe(0);
  });
});

describe('company income tax', () => {
  it('estimates from profit before tax, books the difference and closes with the year', async () => {
    const year = Number(cairoDay(new Date()).slice(0, 4)) - 1;
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: cairoDayStart(`${year}-06-01`),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 1_000_000 },
        { account: { type: 'revenue' }, amount: -1_000_000 },
      ],
    });
    expect(await corporateTaxEstimate(prisma, year)).toMatchObject({
      profitBeforeTaxPiastres: 1_000_000,
      estimatePiastres: 225_000,
      bookedPiastres: 0,
    });
    await bookCorporateTax(prisma, { year, amountPiastres: 225_000, actorUserId: admin });
    // Changed after talking to the accountant: only the difference is posted.
    await bookCorporateTax(prisma, { year, amountPiastres: 200_000, actorUserId: admin });
    expect(await balanceOf(prisma, { type: 'corporate_tax_payable' })).toBe(-200_000);
    const after = await corporateTaxEstimate(prisma, year);
    expect(after).toMatchObject({ profitBeforeTaxPiastres: 1_000_000, bookedPiastres: 200_000 });
    const closed = await closeYear(prisma, { year, actorUserId: admin });
    expect(closed.profitPiastres).toBe(800_000);
    await expect(
      bookCorporateTax(prisma, { year, amountPiastres: 1, actorUserId: admin }),
    ).rejects.toThrow('year_already_closed');
  });
});

describe('comparative statements', () => {
  it('puts a period next to the one before it', async () => {
    const today = cairoDay(new Date());
    const s = await comparativeStatements(prisma, { from: addDays(today, -9), to: today });
    expect(s.previous.to).toBe(addDays(today, -10));
    expect(s.previous.from).toBe(addDays(today, -19));
    expect(s.current.bs.totalAssetsPiastres).toBeGreaterThan(0);
  });
});
