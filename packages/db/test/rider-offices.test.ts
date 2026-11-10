import { cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  addMonths,
  balanceOf,
  cancelBill,
  createSupplier,
  ensureDefaultAccounts,
  listRiderOffices,
  payBill,
  post,
  prepareOfficeBills,
  recordCapital,
  riderOfficeDetail,
  setRiderOffice,
  trialBalance,
  vatReturn,
} from '../src/finance';
import { setEmployment, setPayBasis } from '../src/hr-pay';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  handToRider,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { savePhoto } from '../src/photos';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

// Rider supply offices: an office earns a commission on its riders' pay per delivered order,
// takes over what its riders cannot cover at month end, and is billed once a month.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let riderUserId: string;
let riderId: string;
let officeId: string;
let bankId: string;
let n = 0;
const key = () => `ro-${++n}-${Math.random()}`;
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });
const month = cairoDay(new Date()).slice(0, 7);
/** A moment in the next month, when this month is over. */
const nextMonth = new Date(cairoDayStart(`${addMonths(month, 1)}-05`).getTime() + 12 * 3600_000);
const afterThat = new Date(cairoDayStart(`${addMonths(month, 2)}-05`).getTime() + 12 * 3600_000);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
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
  bankId = (await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } })).id;
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: bankId,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
  await set('rider.bonus_per_delivery_piastres', 3000);
  officeId = (
    await createSupplier(prisma, {
      name: 'Fast Riders Office',
      taxId: '123-456-789',
      whtBp: 300,
      actorUserId: admin,
    })
  ).id;
  await setRiderOffice(prisma, {
    supplierId: officeId,
    isRiderOffice: true,
    commissionBp: 2000,
    actorUserId: admin,
  });
});

afterAll(() => prisma.$disconnect());

async function expectBalanced() {
  const tb = await trialBalance(prisma);
  expect(tb.totalDebitPiastres).toBe(tb.totalCreditPiastres);
}

const link = () =>
  setEmployment(prisma, {
    userId: riderUserId,
    employment: 'outsourced',
    staffingSupplierId: officeId,
    actorUserId: admin,
  });

async function deliver(count = 1) {
  const orders = [];
  for (let i = 0; i < count; i++) {
    const order = await createOrder(prisma, {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      source: 'manual',
      customerName: 'Customer',
      customerPhone: '01012345678',
      addressText: 'Somewhere in Cairo',
      paymentMethod: 'prepaid',
      deliveryFeePiastres: 0,
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
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      otp: full.deliveryOtp,
    });
    orders.push({ order: full, delivery });
  }
  return orders;
}

const commissions = () =>
  prisma.ledgerEntry.findMany({
    where: { kind: 'rider_office_commission' },
    include: { lines: { include: { account: true } } },
    orderBy: { number: 'asc' },
  });

/** Dues the rider owes (a shortage kept on them), as a cash handover charge would post. */
const owe = (amount: number) =>
  post(prisma, {
    kind: 'rider_shortage_charge',
    idempotencyKey: key(),
    lines: [
      { account: { type: 'rider_dues', riderId }, amount },
      { account: { type: 'cash_difference' }, amount: -amount },
    ],
  });

describe('rider office commission', () => {
  it('books the office commission at each delivery at its rate, tagged like rider pay', async () => {
    await link();
    const [{ order, delivery }] = await deliver(1);
    const [entry, ...more] = await commissions();
    expect(more).toHaveLength(0);
    expect(entry!.idempotencyKey).toBe(`delivery:${delivery!.id}:office_commission`);
    expect(entry!.orderId).toBe(order!.id);
    expect(entry!.data).toMatchObject({
      supplierId: officeId,
      riderId,
      payPiastres: 3000,
      commissionBp: 2000,
    });
    const expense = entry!.lines.find((l) => l.account.key === 'rider_office_commission')!;
    const accrued = entry!.lines.find((l) => l.account.key === 'rider_office_accrued')!;
    expect(expense.amountPiastres).toBe(600);
    expect(accrued.amountPiastres).toBe(-600);
    expect(expense.account.code).toBe('5102');
    expect(accrued.account.code).toBe('2402');
    for (const l of entry!.lines)
      expect(l).toMatchObject({
        darkStoreId: f.store.id,
        merchantId: f.merchant.id,
        riderId,
      });
    // The rider is paid exactly as without an office.
    expect(await balanceOf(prisma, { type: 'rider_bonus', riderId })).toBe(-3000);
    await expectBalanced();
  });

  it('books nothing for a rider without an office', async () => {
    await deliver(2);
    expect(await commissions()).toHaveLength(0);
    expect(await balanceOf(prisma, { type: 'rider_bonus', riderId })).toBe(-6000);
  });

  it('takes a new rate only for later deliveries', async () => {
    await link();
    await deliver(1);
    await setRiderOffice(prisma, { supplierId: officeId, commissionBp: 1250, actorUserId: admin });
    await deliver(1);
    const rows = await commissions();
    expect(rows.map((e) => (e.data as { commissionBp: number }).commissionBp)).toEqual([
      2000, 1250,
    ]);
    expect(await balanceOf(prisma, { type: 'rider_office_accrued' })).toBe(-(600 + 375));
    const audit = await prisma.auditLog.findMany({
      where: { action: 'finance.rider_office_update' },
    });
    expect(audit.at(-1)).toMatchObject({
      before: { commissionBp: 2000 },
      after: { commissionBp: 1250 },
    });
  });
});

describe('linking riders to offices', () => {
  it('links only riders paid per delivery, and those only to rider offices', async () => {
    const plain = await createSupplier(prisma, { name: 'Staffing Co', actorUserId: admin });
    await expect(
      setEmployment(prisma, {
        userId: riderUserId,
        employment: 'outsourced',
        staffingSupplierId: plain.id,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'rider_office_required' });
    const clerk = await prisma.user.create({
      data: { email: 'c@t.eg', name: 'Clerk', role: 'admin', passwordHash: 'x' },
    });
    await expect(
      setEmployment(prisma, {
        userId: clerk.id,
        employment: 'outsourced',
        staffingSupplierId: officeId,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'rider_office_riders_only' });
    await link();
    // A linked rider stays per delivery, and the office cannot stop being one meanwhile.
    const file = await prisma.employee.findUniqueOrThrow({ where: { userId: riderUserId } });
    await expect(
      setPayBasis(prisma, { employeeId: file.id, payBasis: 'monthly_salary', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'rider_office_per_delivery_only' });
    await expect(
      setRiderOffice(prisma, { supplierId: officeId, isRiderOffice: false, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'office_has_riders' });
  });
});

describe('month end and the monthly bill', () => {
  it('moves onto the office only what the rider cannot cover from their wallet', async () => {
    await link();
    await deliver(2); // the rider holds 60.00 EGP
    await owe(10_000); // and owes 100.00 EGP
    const result = await prepareOfficeBills(prisma, { month, actorUserId: admin, now: nextMonth });
    expect(result.offices).toHaveLength(1);
    expect(result.offices[0]).toMatchObject({ status: 'billed', shortagesPiastres: 4000 });
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(6000);
    // The rider's wallet is untouched: what they still owe comes from their own earnings.
    expect(await balanceOf(prisma, { type: 'rider_bonus', riderId })).toBe(-6000);
    const moved = await prisma.ledgerEntry.findMany({ where: { kind: 'rider_office_shortage' } });
    expect(moved).toHaveLength(1);
    expect(moved[0]!.idempotencyKey).toBe(`office_shortage:${riderId}:${month}`);
    expect(
      await prisma.auditLog.count({ where: { action: 'finance.rider_office_shortage' } }),
    ).toBe(1);

    // Running again moves nothing more and makes no second bill.
    const again = await prepareOfficeBills(prisma, { month, actorUserId: admin, now: nextMonth });
    expect(again.offices[0]).toMatchObject({ status: 'already_billed' });
    expect(await prisma.bill.count()).toBe(1);
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(6000);
  });

  it('moves nothing when the wallet covers the dues', async () => {
    await link();
    await deliver(2);
    await owe(5000);
    const result = await prepareOfficeBills(prisma, { month, actorUserId: admin, now: nextMonth });
    expect(result.offices[0]!.shortagesPiastres).toBe(0);
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(5000);
  });

  it('bills the commission once with VAT, pays it with withholding and sets off shortages', async () => {
    await set('fee.vat_bp', 1400);
    await link();
    await deliver(5); // pay 150.00, commission 30.00
    await owe(20_000); // 200.00 owed, 150.00 held: 50.00 moves to the office
    await expect(
      prepareOfficeBills(prisma, { month, actorUserId: admin, now: new Date() }),
    ).rejects.toMatchObject({ code: 'month_not_over' });
    const result = await prepareOfficeBills(prisma, {
      month,
      supplierId: officeId,
      actorUserId: admin,
      now: nextMonth,
    });
    const r = result.offices[0]!;
    expect(r).toMatchObject({
      status: 'billed',
      commissionPiastres: 3000,
      vatPiastres: 420,
      totalPiastres: 3420,
      shortagesPiastres: 5000,
    });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: r.billId } });
    expect(bill).toMatchObject({
      supplierId: officeId,
      officeMonth: month,
      netPiastres: 3000,
      vatPiastres: 420,
      whtBp: 300,
      reference: `COMM-${month}`,
    });
    // The accrual is cleared and the VAT is claimed back in the month's VAT return.
    expect(await balanceOf(prisma, { type: 'rider_office_accrued' })).toBe(0);
    const vat = await vatReturn(prisma, month);
    expect(vat).toMatchObject({ purchasesPiastres: 3000, inputVatPiastres: 420 });
    // The office owes us more than the bill: we owe 34.20, it owes 50.00.
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(5000 - 3420);
    await expect(
      cancelBill(prisma, { billId: bill.id, reason: 'entered by mistake', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'bill_from_rider_office' });

    // Pay the bill setting off what the office owes us: withholding on the whole commission.
    await expect(
      payBill(prisma, {
        billId: bill.id,
        amountPiastres: 3420,
        moneyAccountId: bankId,
        reference: 'Set off',
        offsetPiastres: 5001,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'more_than_they_owe' });
    const before = await balanceOf(prisma, { id: bankId });
    const entry = await payBill(prisma, {
      billId: bill.id,
      amountPiastres: 3420,
      moneyAccountId: bankId,
      reference: 'Set off',
      offsetPiastres: 3330,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(entry.data).toMatchObject({ gross: 3420, wht: 90, offset: 3330 });
    expect(await balanceOf(prisma, { id: bankId })).toBe(before); // nothing left the bank
    expect(await balanceOf(prisma, { type: 'wht_payable' })).toBe(-90);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('paid');
    // The office still owes us the rest of the shortages: 50.00 − 33.30 = 16.70.
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(1670);
    const list = await listRiderOffices(prisma, { month });
    expect(list.rows[0]).toMatchObject({
      riders: 1,
      deliveries: 5,
      commissionPiastres: 3000,
      shortagesPiastres: 5000,
      owedPiastres: -1670,
      owesUsPiastres: 1670,
    });
    await expectBalanced();
  });

  it('carries a debit into the next month and never makes a negative bill', async () => {
    await link();
    await deliver(1); // commission 6.00
    await owe(50_000);
    await prepareOfficeBills(prisma, { month, actorUserId: admin, now: nextMonth });
    // 500.00 owed, 30.00 held: 470.00 moves; the bill is 6.00 (no VAT setting).
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(47_000 - 600);
    // The next month has nothing to bill: no bill, the debit stays.
    const next = await prepareOfficeBills(prisma, {
      month: addMonths(month, 1),
      actorUserId: admin,
      now: afterThat,
    });
    expect(next.offices[0]).toMatchObject({ status: 'nothing_to_bill', totalPiastres: 0 });
    expect(await prisma.bill.count()).toBe(1);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(46_400);
    // Months are prepared in order.
    const earlier = await prepareOfficeBills(prisma, {
      month: addMonths(month, -1),
      actorUserId: admin,
      now: afterThat,
    });
    expect(earlier.offices[0]).toMatchObject({ status: 'refused', error: 'later_month_prepared' });
    const detail = await riderOfficeDetail(prisma, { supplierId: officeId, now: nextMonth });
    expect(detail.riders[0]).toMatchObject({ riderId, owesPiastres: 3000 });
    expect(detail.months.find((m) => m.month === month)).toMatchObject({
      deliveries: 1,
      commissionPiastres: 600,
      shortagesPiastres: 47_000,
    });
    expect(detail.wallet.owedPiastres).toBe(-46_400);
  });
});
