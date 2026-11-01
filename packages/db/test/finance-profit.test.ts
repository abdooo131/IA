import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceOf,
  ensureDefaultAccounts,
  giveAdvance,
  listStaffPay,
  post,
  profitBy,
  recordCapital,
  recordExpense,
  runPayroll,
  setSalary,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let staff: string;
let n = 0;
const key = () => `p-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const range = () => ({
  from: new Date(Date.now() - 86_400_000 * 40),
  to: new Date(Date.now() + 60_000),
});

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  staff = (
    await prisma.user.create({
      data: {
        email: 's@t.eg',
        name: 'Samir',
        role: 'store_staff',
        passwordHash: 'x',
        darkStoreId: f.store.id,
      },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('profit per store, merchant and rider', () => {
  it('tags fees by their merchant and costs by the store they belong to', async () => {
    // A fee charged to the merchant counts for that merchant; the store comes from the caller.
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      darkStoreId: f.store.id,
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 50_000 },
        { account: { type: 'revenue' }, amount: -50_000 },
      ],
    });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: (await byKey('bank')).id,
      amountPiastres: 20_000,
      reference: 'R1',
      memo: 'Store rent',
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:utilities')).id,
      paidFromAccountId: (await byKey('bank')).id,
      amountPiastres: 5_000,
      reference: 'R2',
      memo: 'Head office internet',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const byStore = await profitBy(prisma, { ...range(), by: 'store' });
    expect(byStore.rows.find((r) => r.id === f.store.id)).toMatchObject({
      incomePiastres: 50_000,
      costsPiastres: 20_000,
      profitPiastres: 30_000,
    });
    // Company wide costs stay on their own row, last.
    expect(byStore.rows.at(-1)).toMatchObject({ id: null, costsPiastres: 5_000 });
    expect(byStore.total.profitPiastres).toBe(25_000);
    const byMerchant = await profitBy(prisma, { ...range(), by: 'merchant' });
    expect(byMerchant.rows.find((r) => r.id === f.merchant.id)).toMatchObject({
      incomePiastres: 50_000,
    });
  });
});

describe('salaries and advances', () => {
  it('pays the month once, recovers advances and books the cost to the person and store', async () => {
    const cib = await byKey('bank');
    await setSalary(prisma, { userId: staff, monthlyPiastres: 600_000, actorUserId: admin });
    await giveAdvance(prisma, {
      userId: staff,
      amountPiastres: 100_000,
      moneyAccountId: cib.id,
      reference: 'Advance',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect((await listStaffPay(prisma)).find((p) => p.userId === staff)).toMatchObject({
      monthlyPiastres: 600_000,
      advanceOwedPiastres: 100_000,
    });
    // Last month, so the run is dated on its last day.
    const month = addDays(cairoDay(new Date()), -35).slice(0, 7);
    const before = await balanceOf(prisma, { id: cib.id });
    await expect(
      runPayroll(prisma, {
        month,
        moneyAccountId: cib.id,
        lines: [{ userId: staff, advanceRecoveryPiastres: 200_000 }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('more_than_advance');
    await runPayroll(prisma, {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: staff, deductionPiastres: 50_000, advanceRecoveryPiastres: 100_000 }],
      actorUserId: admin,
    });
    // 6,000 − 500 deducted = 5,500 gross; social insurance 11% (605) and the martyrs fund
    // (2.75) come off; no income tax below the first band; 1,000 back from the advance.
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 389_225);
    expect(await balanceOf(prisma, { type: 'social_insurance_payable' })).toBe(-(60_500 + 103_125));
    expect(await balanceOf(prisma, { type: 'staff_advance', userId: staff })).toBe(0);
    const line = await prisma.ledgerLine.findFirstOrThrow({
      where: { account: { key: 'expense:salaries' } },
    });
    expect(line).toMatchObject({ amountPiastres: 550_000, userId: staff, darkStoreId: f.store.id });
    await expect(
      runPayroll(prisma, {
        month,
        moneyAccountId: cib.id,
        lines: [{ userId: staff }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('payroll_already_run');
    await expect(
      runPayroll(prisma, {
        month: '2020-13',
        moneyAccountId: cib.id,
        lines: [{ userId: admin }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('invalid_month');
  });
});
