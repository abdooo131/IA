import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  cancelBill,
  cancelCheque,
  createSupplier,
  disposeAsset,
  ensureDefaultAccounts,
  issueCreditNote,
  journalLines,
  listFixedAssets,
  payBill,
  post,
  recordAssetPurchase,
  recordBill,
  recordCapital,
  registerCheque,
  runMonthlyCharges,
  runPayroll,
  submitCreditNote,
  vatReport,
  vatReturn,
  whtReport,
  withholdingPayments,
  yearCloseStatus,
} from '../src/finance';
import { setSalary } from '../src/hr-pay';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// Regression tests for accounting fixes: Cairo months and days of ledger lines, the VAT
// return and report with cancelled and purchase order bills, withholding with reversed
// cheque payments, credit note VAT, depreciation around a disposal and future payroll runs.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `fix-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const thisMonth = () => cairoDay(new Date()).slice(0, 7);
const lastMonth = () => addMonths(thisMonth(), -1);

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
    day: `${addMonths(thisMonth(), -6)}-01`,
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

const fee = (occurredAt: Date, net = 100_000, vat = 14_000) =>
  post(prisma, {
    kind: 'order_fee',
    idempotencyKey: key(),
    occurredAt,
    lines: [
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount: net + vat },
      { account: { type: 'revenue' }, amount: -net },
      { account: { type: 'vat_payable' }, amount: -vat },
    ],
  });

describe('Cairo months and days of ledger lines', () => {
  it('puts a line at 00:30 Cairo on the 1st in that month, year and day', async () => {
    // 1 January at 00:30 Cairo is still 31 December in UTC.
    const year = Number(thisMonth().slice(0, 4)) - 1;
    const at = new Date(cairoDayStart(`${year}-01-01`).getTime() + 30 * 60_000);
    await fee(at);
    const report = await vatReport(prisma, year);
    expect(report.months[0]).toMatchObject({ month: `${year}-01`, outputPiastres: 14_000 });
    expect(await yearCloseStatus(prisma)).toEqual(
      expect.arrayContaining([expect.objectContaining({ year })]),
    );
    expect((await yearCloseStatus(prisma)).map((y) => y.year)).not.toContain(year - 1);
    const lines = await journalLines(prisma, { from: `${year}-01-01`, to: `${year}-01-01` });
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.day === `${year}-01-01`)).toBe(true);
  });
});

describe('VAT return and report', () => {
  it('takes a cancelled bill back and counts purchase order bills', async () => {
    const supplier = await createSupplier(prisma, {
      name: 'Office supplies',
      defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
      actorUserId: admin,
    });
    const today = cairoDay(new Date());
    await fee(new Date());
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'B-1',
      billDate: today,
      dueDate: today,
      netPiastres: 50_000,
      vatPiastres: 7_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await cancelBill(prisma, { billId: bill.id, reason: 'Entered twice', actorUserId: admin });
    // A bill from a purchase order: packaging into goods received, a lower price on the expense.
    await post(prisma, {
      kind: 'supplier_bill',
      idempotencyKey: key(),
      data: { supplierId: supplier.id, reference: 'PO-1', vat: 2_800, purchaseOrderId: 'x' },
      lines: [
        { account: { type: 'goods_received' }, amount: 21_000 },
        { account: { id: (await byKey('expense:maintenance')).id }, amount: -1_000 },
        { account: { type: 'vat_payable' }, amount: 2_800 },
        { account: { type: 'supplier', supplierId: supplier.id }, amount: -22_800 },
      ],
    });
    const ret = await vatReturn(prisma, thisMonth());
    expect(ret).toMatchObject({
      salesPiastres: 100_000,
      outputVatPiastres: 14_000,
      purchasesPiastres: 20_000,
      inputVatPiastres: 2_800,
      duePiastres: 11_200,
    });
    const month = (await vatReport(prisma, Number(thisMonth().slice(0, 4)))).months.find(
      (m) => m.month === thisMonth(),
    );
    expect(month).toMatchObject({
      outputPiastres: 14_000,
      inputPiastres: 2_800,
      duePiastres: 11_200,
    });
  });

  it('shows a credit note as less output VAT, not as input VAT', async () => {
    await fee(new Date());
    await post(prisma, {
      kind: 'credit_note',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'revenue' }, amount: 10_000 },
        { account: { type: 'vat_payable' }, amount: 1_400 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -11_400 },
      ],
    });
    const month = (await vatReport(prisma, Number(thisMonth().slice(0, 4)))).months.find(
      (m) => m.month === thisMonth(),
    );
    expect(month).toMatchObject({ outputPiastres: 12_600, inputPiastres: 0, duePiastres: 12_600 });
  });
});

describe('withholding with a cheque payment undone', () => {
  it('leaves a cancelled cheque payment out of both withholding lists', async () => {
    const supplier = await createSupplier(prisma, {
      name: 'Landlord',
      taxId: '123456789',
      whtBp: 300,
      defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
      actorUserId: admin,
    });
    const today = cairoDay(new Date());
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'R-1',
      billDate: today,
      dueDate: today,
      netPiastres: 100_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const cheque = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'bill',
      chequeNumber: '7001',
      bankAccountId: (await byKey('bank')).id,
      amountPiastres: 100_000,
      issueDate: today,
      dueDate: addDays(today, 10),
      billId: bill.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(cheque.status).toBe('posted');
    await cancelCheque(prisma, { chequeId: cheque.cheque.id, note: 'Torn', actorUserId: admin });
    const quarter = {
      year: Number(today.slice(0, 4)),
      quarter: Math.ceil(Number(today.slice(5, 7)) / 3),
    };
    expect(await withholdingPayments(prisma, quarter)).toEqual([]);
    expect((await whtReport(prisma, quarter)).totalWhtPiastres).toBe(0);
    // Paid again by transfer: that payment is listed once.
    await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 100_000,
      moneyAccountId: (await byKey('bank')).id,
      reference: 'T-1',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await withholdingPayments(prisma, quarter)).toHaveLength(1);
    expect((await whtReport(prisma, quarter)).totalWhtPiastres).toBe(3_000);
  });
});

describe('credit notes', () => {
  const invoice = () =>
    prisma.taxInvoice.create({
      data: {
        type: 'invoice',
        number: 1,
        merchantId: f.merchant.id,
        periodMonth: lastMonth(),
        netPiastres: 100,
        vatPiastres: 14,
        totalPiastres: 114,
        createdById: admin,
      },
    });

  it('never gives back more VAT than the invoice charged', async () => {
    const inv = await invoice();
    for (const amount of [33, 33, 34])
      await issueCreditNote(prisma, {
        invoiceId: inv.id,
        amountPiastres: amount,
        reason: 'Late deliveries',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    const notes = await prisma.taxInvoice.findMany({
      where: { originalId: inv.id },
      orderBy: { number: 'asc' },
    });
    expect(notes.map((x) => x.vatPiastres)).toEqual([5, 4, 5]);
    expect(notes.reduce((s, x) => s + x.vatPiastres, 0)).toBe(14);
  });

  it('always waits for a second person, even with approve money in off', async () => {
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: null });
    const inv = await invoice();
    const result = await submitCreditNote(prisma, {
      invoiceId: inv.id,
      amountPiastres: 50,
      reason: 'Late deliveries',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(result.status).toBe('pending');
  });
});

describe('depreciation around a disposal', () => {
  const buy = async (startMonth: string) => {
    await recordAssetPurchase(prisma, {
      name: 'Scooter',
      amountPiastres: 1_200_000,
      lifeMonths: 12,
      startMonth,
      moneyAccountId: (await byKey('bank')).id,
      reference: 'Dealer',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    return (await listFixedAssets(prisma))[0]!;
  };

  it('charges the months before the disposal first, and nothing after', async () => {
    const asset = await buy(addMonths(thisMonth(), -2));
    await disposeAsset(prisma, {
      assetId: asset.id,
      salePiastres: 700_000,
      moneyAccountId: (await byKey('bank')).id,
      reason: 'Sold to a dealer',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // Two months depreciated before it left: 12,000 − 2,000 − 7,000 = 3,000 loss.
    expect(await balanceOf(prisma, { type: 'depreciation_expense' })).toBe(200_000);
    expect(await balanceOf(prisma, { type: 'asset_disposal' })).toBe(300_000);
    expect(await balanceOf(prisma, { type: 'accumulated_depreciation' })).toBe(0);
    expect((await runMonthlyCharges(prisma, new Date(Date.now() + 70 * 86_400_000))).charged).toBe(
      0,
    );
    expect(await balanceOf(prisma, { type: 'accumulated_depreciation' })).toBe(0);
  });

  it('refuses a disposal dated before a month already charged', async () => {
    const asset = await buy(addMonths(thisMonth(), -3));
    await runMonthlyCharges(prisma);
    await expect(
      disposeAsset(prisma, {
        assetId: asset.id,
        salePiastres: 0,
        reason: 'Stolen in the spring',
        day: `${addMonths(thisMonth(), -2)}-15`,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('disposal_before_charged_month');
  });
});

describe('payroll', () => {
  it('refuses a month that has not started yet', async () => {
    const staff = await prisma.user.create({
      data: { email: 's@t.eg', name: 'Sara', role: 'store_staff', passwordHash: 'x' },
    });
    await setSalary(prisma, { userId: staff.id, monthlyPiastres: 600_000, actorUserId: admin });
    await expect(
      runPayroll(prisma, {
        month: addMonths(thisMonth(), 1),
        moneyAccountId: (await byKey('bank')).id,
        lines: [{ userId: staff.id }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('future_month');
    // The current month may be paid at its end (dated now).
    await expect(
      runPayroll(prisma, {
        month: thisMonth(),
        moneyAccountId: (await byKey('bank')).id,
        lines: [{ userId: staff.id }],
        actorUserId: admin,
      }),
    ).resolves.toBeTruthy();
  });
});
