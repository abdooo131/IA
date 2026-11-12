import { addDays, availableFrom, cairoDay, cairoDayStart, weekendDays } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  approveWithdrawal,
  balanceOf,
  cancelWithdrawal,
  chargeRiderPenalties,
  ensureDefaultAccounts,
  giveAdvance,
  listStaffPay,
  payWithdrawal,
  previewPayroll,
  recordCapital,
  recordBankDeposit,
  recordCashHandover,
  rejectWithdrawal,
  requestWithdrawal,
  reviewCashHandover,
  riderCash,
  riderHoldRules,
  riderOwed,
  riderWallet,
  riderWalletTotals,
  trialBalance,
} from '../src/finance';
import { finalDeductionsFor } from '../src/hr-violations';
import { setPayBasis, setSalaryPackage } from '../src/hr-pay';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  failDelivery,
  handToRider,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { savePhoto } from '../src/photos';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

// Rider pay (CLAUDE.md "Rider pay"): earnings per delivered order only, held for working days,
// withdrawn with what the rider owes taken first, paid by Accounting with the second person rule.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let other: string;
let riderUserId: string;
let riderId: string;
let n = 0;
const key = () => `rw-${++n}-${Math.random()}`;
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });
/** A moment on a Cairo day (noon), for "what does the wallet show then". */
const on = (day: string) => new Date(cairoDayStart(day).getTime() + 12 * 3600_000);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: 'b@t.eg', name: 'Second', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  const rider = await createUser(prisma, {
    email: 'r@t.eg',
    name: 'Rider',
    role: 'rider',
    password: 'long-password-1',
    darkStoreId: f.store.id,
    badgeCode: 'RDR-1',
    actorUserId: admin,
  });
  riderUserId = rider.id;
  riderId = (await prisma.rider.findUniqueOrThrow({ where: { userId: rider.id } })).id;
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 30 });
  await ensureDefaultAccounts(prisma);
  const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: bank.id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
  await set('rider.bonus_per_delivery_piastres', 3000);
  await set('rider.min_withdrawal_piastres', 5000);
});

afterAll(() => prisma.$disconnect());

async function outForDelivery() {
  const order = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 3000,
    items: [{ skuId: f.sku.id, quantity: 1 }],
    actorUserId: admin,
  });
  const ids = { orderId: order.id, darkStoreId: f.store.id, actorUserId: admin };
  await acceptOrder(prisma, ids);
  await pickOrderItem(prisma, { ...ids, skuId: f.sku.id, quantity: 1, idempotencyKey: key() });
  const photo = await savePhoto(prisma, {
    kind: 'pack',
    contentType: 'image/jpeg',
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    actorUserId: admin,
  });
  await packOrder(prisma, { ...ids, photoId: photo.id });
  await handToRider(prisma, { ...ids, badgeCode: 'RDR-1' });
  const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: order.id } });
  return { order: full, delivery };
}

async function deliver(count = 1) {
  for (let i = 0; i < count; i++) {
    const { order, delivery } = await outForDelivery();
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      otp: order.deliveryOtp,
      codCollectedPiastres: order.codAmountPiastres,
    });
  }
}

/** The first moment every earning made today is available. */
async function whenAvailable() {
  const rules = await riderHoldRules(prisma);
  return on(availableFrom(cairoDay(new Date()), rules));
}

type Details = Parameters<typeof requestWithdrawal>[1]['body']['details'];
const instapay: Details = { method: 'instapay', handle: 'rider1@instapay' };
const request = (
  amountPiastres: number,
  now: Date,
  idempotencyKey = key(),
  details: Details = instapay,
) =>
  requestWithdrawal(prisma, {
    riderUserId,
    body: { amountPiastres, details, idempotencyKey },
    now,
  });

describe('earning', () => {
  it('earns a fixed amount per delivered order and nothing for a failed attempt', async () => {
    await deliver(2);
    const { order, delivery } = await outForDelivery();
    const photo = await savePhoto(prisma, {
      kind: 'delivery',
      contentType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      actorUserId: admin,
    });
    await failDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      reason: 'customer_refused',
      photoId: photo.id,
    });
    expect(order.status).toBe('out_for_delivery');
    const { totals } = await riderWalletTotals(prisma, riderId);
    expect(totals.earnedAllPiastres).toBe(6000);
    expect(totals.earnedMonthPiastres).toBe(6000);
  });

  it('holds earnings for working days, skipping Fridays and official holidays', async () => {
    await set('rider.withdraw_hold_working_days', 3);
    await set('rider.weekend_days', 5);
    const today = cairoDay(new Date());
    await prisma.holiday.create({
      data: { day: new Date(`${addDays(today, 1)}T00:00:00Z`), nameEn: 'Feast', nameAr: 'عيد' },
    });
    await deliver(1);
    const rules = await riderHoldRules(prisma);
    expect(rules.weekend).toEqual([5]);
    // Count the working days by hand: the holiday and any Friday are skipped.
    let day = today;
    let left = 3;
    while (left > 0) {
      day = addDays(day, 1);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      if (weekday === 5 || day === addDays(today, 1)) continue;
      left--;
    }
    const from = addDays(day, 1);
    const wallet = await riderWallet(prisma, riderId, on(addDays(from, -1)));
    expect(wallet.earnings[0]!.availableOn).toBe(from);
    expect(wallet.totals).toMatchObject({ onHoldPiastres: 3000, availablePiastres: 0 });
    // Available from the start of that Cairo day, not a moment before.
    const before = await riderWalletTotals(
      prisma,
      riderId,
      new Date(cairoDayStart(from).getTime() - 1),
    );
    expect(before.totals.availablePiastres).toBe(0);
    const at = await riderWalletTotals(prisma, riderId, cairoDayStart(from));
    expect(at.totals).toMatchObject({ onHoldPiastres: 0, availablePiastres: 3000 });
  });

  it('reads weekend days as digits', () => {
    expect(weekendDays(5)).toEqual([5]);
    expect(weekendDays(56)).toEqual([5, 6]);
    expect(weekendDays(50)).toEqual([5, 0]);
  });
});

describe('withdrawals', () => {
  it('limits the amount (minimum, available) and keeps one request open', async () => {
    await deliver(3); // 90.00 EGP
    const later = await whenAvailable();
    await expect(request(1000, new Date())).rejects.toMatchObject({ code: 'more_than_available' });
    await expect(request(9001, later)).rejects.toMatchObject({ code: 'more_than_available' });
    await expect(request(4000, later)).rejects.toMatchObject({ code: 'below_minimum' });
    const first = await request(6000, later);
    expect(first).toMatchObject({ number: 'RW-000001', status: 'requested', amountPiastres: 6000 });
    // One open at a time (rider.max_open_withdrawals).
    await expect(request(3000, later)).rejects.toMatchObject({ code: 'withdrawal_already_open' });
    const { totals } = await riderWalletTotals(prisma, riderId, later);
    expect(totals).toMatchObject({ pendingPiastres: 6000, availablePiastres: 3000 });
  });

  it('answers the same request for the same key', async () => {
    await deliver(2);
    const later = await whenAvailable();
    const k = key();
    const a = await request(6000, later, k);
    const b = await request(6000, later, k);
    expect(b.id).toBe(a.id);
    expect(await prisma.riderWithdrawal.count()).toBe(1);
  });

  it('allows everything available even below the minimum', async () => {
    await deliver(1); // 30.00 EGP, minimum 50.00
    const later = await whenAvailable();
    const w = await request(3000, later);
    expect(w.amountPiastres).toBe(3000);
  });

  it('gives the amount back when the rider cancels or Accounting rejects', async () => {
    await deliver(4);
    const later = await whenAvailable();
    const w = await request(12_000, later);
    expect((await riderWalletTotals(prisma, riderId, later)).totals.availablePiastres).toBe(0);
    await cancelWithdrawal(prisma, { withdrawalId: w.id, riderUserId });
    expect((await riderWalletTotals(prisma, riderId, later)).totals.availablePiastres).toBe(12_000);
    await expect(
      cancelWithdrawal(prisma, { withdrawalId: w.id, riderUserId }),
    ).rejects.toMatchObject({ code: 'withdrawal_not_requested' });

    const again = await request(12_000, later);
    await approveWithdrawal(prisma, { withdrawalId: again.id, actorUserId: admin });
    // Approved: the rider can no longer take it back.
    await expect(
      cancelWithdrawal(prisma, { withdrawalId: again.id, riderUserId }),
    ).rejects.toMatchObject({ code: 'withdrawal_not_requested' });
    await rejectWithdrawal(prisma, {
      withdrawalId: again.id,
      reason: 'Wrong wallet number',
      actorUserId: admin,
    });
    const after = await riderWallet(prisma, riderId, later);
    expect(after.totals.availablePiastres).toBe(12_000);
    expect(after.withdrawals[0]).toMatchObject({
      status: 'rejected',
      rejectReason: 'Wrong wallet number',
    });
    // Nothing reached the books.
    expect(await prisma.ledgerEntry.count({ where: { kind: 'rider_withdrawal' } })).toBe(0);
  });

  it('takes what the rider owes first, in one balanced entry', async () => {
    await deliver(10); // 300.00 EGP
    // A 20.00 EGP shortage kept on the rider moves from rider cash to what they owe.
    const handover = await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: (await riderCash(prisma, riderId)) - 2000,
      receivedById: admin,
      idempotencyKey: key(),
    });
    await reviewCashHandover(prisma, {
      handoverId: handover.id,
      decision: 'charge_rider',
      note: 'Short at the end of shift',
      actorUserId: admin,
    });
    expect(await riderCash(prisma, riderId)).toBe(0);
    // A 50.00 EGP advance from the bank.
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await giveAdvance(prisma, {
      userId: riderUserId,
      amountPiastres: 5000,
      moneyAccountId: bank.id,
      reference: 'Advance',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await riderOwed(prisma, riderId)).toEqual({
      duesPiastres: 2000,
      advancePiastres: 5000,
      totalPiastres: 7000,
    });

    const later = await whenAvailable();
    const wallet = await riderWallet(prisma, riderId, later);
    // Available already nets what is owed: 300 − 20 − 50.
    expect(wallet.totals.availablePiastres).toBe(23_000);
    expect(wallet.owed.charges[0]).toMatchObject({
      kind: 'rider_shortage_charge',
      amountPiastres: 2000,
    });
    const w = await request(23_000, later);
    expect(w).toMatchObject({
      deductionPiastres: 7000,
      deductions: { duesPiastres: 2000, advancePiastres: 5000 },
      grossPiastres: 30_000,
    });
    await approveWithdrawal(prisma, { withdrawalId: w.id, actorUserId: other });
    const paid = await payWithdrawal(prisma, {
      withdrawalId: w.id,
      reference: 'CIB-123',
      actorUserId: admin,
      now: later,
    });
    expect(paid).toMatchObject({ status: 'paid', reference: 'CIB-123' });

    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { kind: 'rider_withdrawal' },
      include: { lines: { include: { account: true } } },
    });
    const line = (type: string) =>
      entry.lines.find((l) => l.account.type === type)?.amountPiastres ?? 0;
    expect(line('rider_bonus')).toBe(30_000);
    expect(line('rider_dues')).toBe(-2000);
    expect(line('staff_advance')).toBe(-5000);
    expect(line('bank')).toBe(-23_000);
    expect(entry.lines.reduce((s, l) => s + l.amountPiastres, 0)).toBe(0);
    expect(entry.lines.every((l) => l.riderId === riderId && l.darkStoreId === f.store.id)).toBe(
      true,
    );
    expect(await riderOwed(prisma, riderId)).toMatchObject({ totalPiastres: 0 });
    const after = await riderWalletTotals(prisma, riderId, later);
    expect(after.totals).toMatchObject({ availablePiastres: 0, balancePiastres: 0 });
    const tb = await trialBalance(prisma);
    expect(tb.totalDebitPiastres).toBe(tb.totalCreditPiastres);

    // Paying twice changes nothing.
    await expect(
      payWithdrawal(prisma, { withdrawalId: w.id, reference: 'again', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'withdrawal_already_paid' });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'rider_withdrawal' } })).toBe(1);
  });

  it('pays cash at the store from the store box, which must hold it', async () => {
    await deliver(4); // 120.00 EGP earned, 4 × 40.00 cash collected
    const later = await whenAvailable();
    const w = await request(12_000, later, key(), { method: 'store_cash' });
    await approveWithdrawal(prisma, { withdrawalId: w.id, actorUserId: admin });
    await expect(
      payWithdrawal(prisma, {
        withdrawalId: w.id,
        reference: 'cash',
        actorUserId: other,
        storeId: f.store.id,
        now: later,
      }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: await riderCash(prisma, riderId),
      receivedById: admin,
      idempotencyKey: key(),
    });
    // Another store's manager cannot pay it.
    await expect(
      payWithdrawal(prisma, {
        withdrawalId: w.id,
        reference: 'cash',
        actorUserId: other,
        storeId: f.other.id,
        now: later,
      }),
    ).rejects.toMatchObject({ code: 'withdrawal_not_found' });
    const box = await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id });
    await payWithdrawal(prisma, {
      withdrawalId: w.id,
      reference: 'Cash at store',
      actorUserId: other,
      storeId: f.store.id,
      now: later,
    });
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(
      box - 12_000,
    );
  });

  it('locks the store box: two payments at once cannot both spend the same cash', async () => {
    await deliver(4); // 4 × 40.00 cash collected
    const later = await whenAvailable();
    const w = await request(12_000, later, key(), { method: 'store_cash' });
    await approveWithdrawal(prisma, { withdrawalId: w.id, actorUserId: admin });
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 16_000,
      receivedById: admin,
      idempotencyKey: key(),
    });
    const box = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { key: `store_cash:${f.store.id}` },
    });
    // Someone else holds the box for a moment, so both payments start before either posts.
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ledger_accounts WHERE id = ${box.id} FOR UPDATE`;
      held();
      await tx.$executeRaw`SELECT pg_sleep(1.5)`;
    });
    await holding;
    const results = await Promise.allSettled([
      payWithdrawal(prisma, {
        withdrawalId: w.id,
        reference: 'Cash at store',
        actorUserId: other,
        storeId: f.store.id,
        now: later,
      }),
      recordBankDeposit(prisma, {
        darkStoreId: f.store.id,
        amountPiastres: 16_000,
        reference: 'DEP-1',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ]);
    await holder;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['not_enough_money', 'more_than_cash_in_store']).toContain(refused.reason.code);
    expect(
      await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id }),
    ).toBeGreaterThanOrEqual(0);
  });

  it('needs a second person to pay from the approval limit', async () => {
    await set('finance.approval_threshold_piastres', 10_000);
    await deliver(4);
    const later = await whenAvailable();
    const w = await request(12_000, later);
    // The rider can never approve their own.
    await expect(
      approveWithdrawal(prisma, { withdrawalId: w.id, actorUserId: riderUserId }),
    ).rejects.toMatchObject({ code: 'own_withdrawal' });
    await expect(
      payWithdrawal(prisma, { withdrawalId: w.id, reference: 'x1', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'withdrawal_not_approved' });
    await approveWithdrawal(prisma, { withdrawalId: w.id, actorUserId: admin });
    await expect(
      payWithdrawal(prisma, {
        withdrawalId: w.id,
        reference: 'x1',
        actorUserId: admin,
        now: later,
      }),
    ).rejects.toMatchObject({ code: 'same_person' });
    await payWithdrawal(prisma, {
      withdrawalId: w.id,
      reference: 'x1',
      actorUserId: other,
      now: later,
    });

    // Below the limit one person may approve and pay.
    await deliver(1);
    const later2 = await whenAvailable();
    const small = await request(3000, later2);
    await approveWithdrawal(prisma, { withdrawalId: small.id, actorUserId: admin });
    await payWithdrawal(prisma, {
      withdrawalId: small.id,
      reference: 'x2',
      actorUserId: admin,
      now: later2,
    });
    expect(await prisma.riderWithdrawal.count({ where: { status: 'paid' } })).toBe(2);
  });
});

describe('per delivery riders and HR', () => {
  it('opens rider files per delivery, off the salary run and without a package', async () => {
    const file = await prisma.employee.findUniqueOrThrow({ where: { userId: riderUserId } });
    expect(file.payBasis).toBe('per_delivery');
    await expect(
      setSalaryPackage(prisma, {
        employeeId: file.id,
        body: { basicPiastres: 500_000, insuredWagePiastres: null, allowances: [] },
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'per_delivery_no_salary' });
    expect((await listStaffPay(prisma)).map((r) => r.userId)).not.toContain(riderUserId);
    await expect(
      previewPayroll(prisma, {
        month: '2026-10',
        moneyAccountId: 'x',
        lines: [{ userId: riderUserId, grossPiastres: 100 }],
      }),
    ).rejects.toMatchObject({ code: 'per_delivery_not_on_payroll' });
    // Only riders can be paid per delivery.
    const staff = await prisma.user.create({
      data: { email: 's@t.eg', name: 'Staff', role: 'store_staff', passwordHash: 'x' },
    });
    const staffFile = await prisma.employee.create({
      data: { userId: staff.id, nameEn: 'Staff' },
    });
    await expect(
      setPayBasis(prisma, {
        employeeId: staffFile.id,
        payBasis: 'per_delivery',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'per_delivery_riders_only' });
  });

  it('sends a final violation deduction of a per delivery rider to the wallet, not payroll', async () => {
    await set('rider.penalty_day_piastres', 20_000);
    const file = await prisma.employee.findUniqueOrThrow({ where: { userId: riderUserId } });
    const type = await prisma.violationType.create({
      data: {
        code: 'LATE',
        nameEn: 'Late',
        nameAr: 'تأخير',
        category: 'attendance',
      },
    });
    const base = {
      employeeId: file.id,
      typeId: type.id,
      occurredOn: new Date(`${cairoDay(new Date())}T00:00:00Z`),
      description: 'Late',
      suggestedStep: 1,
      step: 1,
      status: 'final' as const,
      recordedById: admin,
      finalAt: new Date(),
    };
    const days = await prisma.violation.create({
      data: { ...base, penalty: 'deduction_days', days: 0.5 },
    });
    await prisma.violation.create({
      data: { ...base, penalty: 'deduction_amount', amountPiastres: 7500 },
    });
    expect(await finalDeductionsFor(prisma, file.id, cairoDay(new Date()))).toHaveLength(0);
    expect(await chargeRiderPenalties(prisma)).toEqual({ charged: 2 });
    // Running again changes nothing.
    expect(await chargeRiderPenalties(prisma)).toEqual({ charged: 0 });
    expect(await riderOwed(prisma, riderId)).toMatchObject({ duesPiastres: 10_000 + 7500 });
    const row = await prisma.violation.findUniqueOrThrow({ where: { id: days.id } });
    expect(row.deductionPiastres).toBe(10_000);
    expect(row.payrollEntryId).not.toBeNull();
    // The penalty lowers rider pay cost.
    expect(await balanceOf(prisma, { type: 'rider_bonus_expense' })).toBe(-17_500);
  });
});
