import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  billAgeing,
  cancelBill,
  createRecurring,
  createSupplier,
  ensureDefaultAccounts,
  listFixedAssets,
  listPrepayments,
  merchantsOwingUs,
  payBill,
  payTax,
  post,
  recordAssetPurchase,
  recordBill,
  recordCapital,
  recordPrepayment,
  requestMerchantPayment,
  runMonthlyCharges,
  runRecurring,
  taxesOwed,
  whtReport,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `pay-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());

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
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('supplier bills', () => {
  it('books the cost when the bill arrives and keeps back withholding tax when paid', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    // 1% withholding tax on what is paid before VAT.
    const landlord = await createSupplier(prisma, {
      name: 'Nasr City landlord',
      taxId: '123-456-789',
      whtBp: 100,
      defaultExpenseAccountId: rent.id,
      actorUserId: admin,
    });
    await expect(
      createSupplier(prisma, { name: 'nasr city LANDLORD', actorUserId: admin }),
    ).rejects.toThrow('supplier_exists');
    const day = addDays(today(), -40);
    const bill = await recordBill(prisma, {
      supplierId: landlord.id,
      reference: 'INV-77',
      billDate: day,
      dueDate: addDays(day, 5),
      darkStoreId: f.store.id,
      netPiastres: 1_000_000,
      vatPiastres: 140_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(bill).toMatchObject({ number: 1, totalPiastres: 1_140_000, status: 'open' });
    await expect(
      recordBill(prisma, {
        supplierId: landlord.id,
        reference: 'INV-77',
        billDate: day,
        dueDate: day,
        netPiastres: 10,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('bill_exists');
    // The cost counts for the store now; we owe the landlord the whole bill.
    expect(await balanceOf(prisma, { id: rent.id })).toBe(1_000_000);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: landlord.id })).toBe(-1_140_000);
    // Thirty five days late: in the 31 to 60 bucket.
    const ageing = await billAgeing(prisma);
    expect(ageing.rows[0]!.buckets.d31_60).toBe(1_140_000);

    const before = await balanceOf(prisma, { id: cib.id });
    // Paid in two parts; the withholding adds up to exactly 1% of 10,000 EGP.
    await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 333_333,
      moneyAccountId: cib.id,
      reference: 'T1',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await expect(
      payBill(prisma, {
        billId: bill.id,
        amountPiastres: 1_000_000,
        moneyAccountId: cib.id,
        reference: 'T2',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('more_than_owed');
    await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 806_667,
      moneyAccountId: cib.id,
      reference: 'T2',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).toMatchObject({
      status: 'paid',
      paidPiastres: 1_140_000,
    });
    expect((await taxesOwed(prisma)).whtPiastres).toBe(10_000);
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 1_130_000);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: landlord.id })).toBe(0);
    const quarter = Math.ceil(Number(today().slice(5, 7)) / 3);
    const report = await whtReport(prisma, { year: Number(today().slice(0, 4)), quarter });
    expect(report.rows[0]).toMatchObject({
      taxId: '123-456-789',
      netPiastres: 1_000_000,
      whtPiastres: 10_000,
      payments: 2,
    });

    // Paying the tax authority more than we owe is refused.
    await expect(
      payTax(prisma, {
        tax: 'wht',
        amountPiastres: 10_001,
        moneyAccountId: cib.id,
        reference: 'Form 41',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('more_than_owed');
    await payTax(prisma, {
      tax: 'wht',
      amountPiastres: 10_000,
      moneyAccountId: cib.id,
      reference: 'Form 41',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect((await taxesOwed(prisma)).whtPiastres).toBe(0);
  });

  it('cancels an unpaid bill by reversing it', async () => {
    const supplier = await createSupplier(prisma, { name: 'Box maker', actorUserId: admin });
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'B1',
      billDate: today(),
      dueDate: today(),
      expenseAccountId: (await byKey('expense:packaging')).id,
      netPiastres: 50_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await cancelBill(prisma, { billId: bill.id, reason: 'Entered twice', actorUserId: admin });
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: supplier.id })).toBe(0);
    expect(await balanceOf(prisma, { id: (await byKey('expense:packaging')).id })).toBe(0);
    await expect(
      cancelBill(prisma, { billId: bill.id, reason: 'Again please', actorUserId: admin }),
    ).rejects.toThrow('bill_not_open');
  });
});

describe('prepayments and fixed assets', () => {
  it('charges each month once it is over, exactly to the piastre', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    const thisMonth = today().slice(0, 7);
    const start = addMonths(thisMonth, -3);
    await recordPrepayment(prisma, {
      name: 'Store rent, 3 months',
      expenseAccountId: rent.id,
      amountPiastres: 1_000_000,
      months: 3,
      startMonth: start,
      darkStoreId: f.store.id,
      moneyAccountId: cib.id,
      reference: 'Lease',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordAssetPurchase(prisma, {
      name: 'Motorbike',
      amountPiastres: 4_000_000,
      salvagePiastres: 400_000,
      lifeMonths: 36,
      startMonth: addMonths(thisMonth, -1),
      darkStoreId: f.store.id,
      moneyAccountId: cib.id,
      reference: 'Dealer',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const first = await runMonthlyCharges(prisma);
    // Three rent months and one month of the bike (this month is not over yet).
    expect(first).toEqual({ charged: 4, failed: [] });
    expect(await runMonthlyCharges(prisma)).toEqual({ charged: 0, failed: [] });
    expect(await balanceOf(prisma, { id: rent.id })).toBe(1_000_000);
    expect(await balanceOf(prisma, { type: 'prepaid' })).toBe(0);
    const [rentRow] = await listPrepayments(prisma);
    expect(rentRow).toMatchObject({ monthsCharged: 3, leftPiastres: 0 });
    const [bike] = await listFixedAssets(prisma);
    expect(bike).toMatchObject({
      monthlyPiastres: 100_000,
      monthsCharged: 1,
      bookValuePiastres: 3_900_000,
    });
    const depreciation = await prisma.ledgerLine.findFirstOrThrow({
      where: { account: { key: 'depreciation_expense' } },
    });
    expect(depreciation).toMatchObject({ amountPiastres: 100_000, darkStoreId: f.store.id });
  });
});

describe('recurring expenses', () => {
  it('prepares one request per month on its day, never posting by itself', async () => {
    const thisMonth = today().slice(0, 7);
    await createRecurring(prisma, {
      name: 'Internet',
      expense: {
        expenseAccountId: (await byKey('expense:utilities')).id,
        paidFromAccountId: (await byKey('bank')).id,
        amountPiastres: 60_000,
        memo: 'Internet',
        reference: 'WE',
      },
      dayOfMonth: 1,
      startMonth: thisMonth,
      actorUserId: admin,
    });
    expect(await runRecurring(prisma)).toEqual({ prepared: 1, failed: [] });
    expect(await runRecurring(prisma)).toEqual({ prepared: 0, failed: [] });
    const request = await prisma.financeRequest.findFirstOrThrow();
    expect(request).toMatchObject({ kind: 'expense', status: 'pending', amountPiastres: 60_000 });
    expect(await balanceOf(prisma, { id: (await byKey('expense:utilities')).id })).toBe(0);
  });
});

describe('merchants who owe us', () => {
  it('lists debit wallets and sends a payment request', async () => {
    await post(prisma, {
      kind: 'storage_fee',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 25_000 },
        { account: { type: 'revenue' }, amount: -25_000 },
      ],
    });
    const owing = await merchantsOwingUs(prisma);
    expect(owing).toHaveLength(1);
    expect(owing[0]).toMatchObject({ merchantId: f.merchant.id, owesPiastres: 25_000 });
    expect(owing[0]!.since).toBeInstanceOf(Date);
    await requestMerchantPayment(prisma, { merchantId: f.merchant.id, actorUserId: admin });
    expect(
      await prisma.notification.findFirstOrThrow({ where: { type: 'payment_requested' } }),
    ).toMatchObject({ merchantId: f.merchant.id });
    expect((await merchantsOwingUs(prisma))[0]!.lastRequestedAt).toBeInstanceOf(Date);
  });
});
