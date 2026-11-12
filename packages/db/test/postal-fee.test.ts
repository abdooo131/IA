import { cairoDay, monthEnd, shiftDayByMonths } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  balanceOf,
  merchantOwed,
  merchantProfitability,
  paymentsDue,
  payTax,
  post,
  share,
  taxesOwed,
  vatReport,
  vatReturn,
} from '../src/finance';
import { postDeliveryCompleted, postDeliveryFailed } from '../src/finance/postings';
import {
  acceptOrder,
  completeDelivery,
  createOrder,
  failDelivery,
  handToRider,
  packOrder,
  pickOrderItem,
} from '../src/orders';
import { accrueStorage } from '../src/finance/postings';
import { closeManifest, createManifest, receiveOnManifest } from '../src/inbound';
import { savePhoto } from '../src/photos';
import { createReturn, handOverReturn, pickForReturn } from '../src/returns';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

// Postal fee (owner, 2026-11-11; all revenue 2026-11-12): fee.postal_bp (10%) of all our
// fee revenue before VAT (shipments, failed attempts, receiving, storage, returns, minimums,
// debit notes; credit notes give it back), our cost (Dr 5103, Cr 2307), never charged to the
// merchant, paid monthly from Taxes.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let riderUserId: string;
let n = 0;
const key = () => `pf-${++n}-${Math.random()}`;

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
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 20 });
  // Odd amounts so the 10% share has to round: half piastres round up like every fee.
  await set('fee.order_fixed_piastres', 4505);
  await set('fee.order_percent_bp', 200);
  await set('fee.cod_percent_bp', 100);
  await set('fee.vat_bp', 1400);
  await set('rider.bonus_per_delivery_piastres', 1000);
  await set('fee.failed_delivery_piastres', 2505);
});

afterAll(() => prisma.$disconnect());

const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number) =>
  changeSetting(prisma, { key: k, scope: 'global', value, actorUserId: admin });

async function outForDelivery(qty: number) {
  const order = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 3000,
    items: [{ skuId: f.sku.id, quantity: qty }],
    actorUserId: admin,
  });
  const ids = { orderId: order.id, darkStoreId: f.store.id, actorUserId: admin };
  await acceptOrder(prisma, ids);
  await pickOrderItem(prisma, { ...ids, skuId: f.sku.id, quantity: qty, idempotencyKey: key() });
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

const postalEntries = () =>
  prisma.ledgerEntry.findMany({ where: { kind: 'postal_fee' }, include: { lines: true } });

describe('postal fee', () => {
  it('books 10% of the fees of a delivered shipment as our cost, once', async () => {
    const { order, delivery } = await outForDelivery(3);
    // 3 units of 10.00 EGP plus 30.00 delivery: 60.00 EGP cash.
    await completeDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      otp: order.deliveryOtp,
      codCollectedPiastres: 6000,
    });
    // Order fee 45.05 + 2% of 30.00 = 45.65; COD fee 1% of 60.00 = 0.60: fees 46.25 EGP.
    const fees = 4505 + 60 + 60;
    const postal = share(fees, 1000);
    expect(postal).toBe(463); // 462.5 rounds up

    const entries = await postalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.idempotencyKey).toBe(`delivery:${delivery.id}:postal_fee`);
    expect(entries[0]!.orderId).toBe(order.id);
    expect(entries[0]!.data).toMatchObject({ basePiastres: fees, bp: 1000 });
    // Tagged with the order's store and merchant (profit per store and per merchant).
    for (const l of entries[0]!.lines) {
      expect(l.darkStoreId).toBe(f.store.id);
      expect(l.merchantId).toBe(f.merchant.id);
    }
    expect(await balanceOf(prisma, { type: 'postal_fee_expense' })).toBe(postal);
    expect(await balanceOf(prisma, { type: 'postal_fee_payable' })).toBe(-postal);
    const accounts = await prisma.ledgerAccount.findMany({
      where: { key: { in: ['postal_fee_expense', 'postal_fee_payable'] } },
      orderBy: { code: 'asc' },
    });
    expect(accounts.map((a) => [a.code, a.category])).toEqual([
      ['2307', 'liability'],
      ['5103', 'expense'],
    ]);

    // The merchant pays our fees plus VAT, nothing more: the postal fee never touches them.
    // VAT is worked out per fee entry (order fee, COD fee).
    const vat = share(4505 + 60, 1400) + share(60, 1400);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(6000 - fees - vat);
    // No VAT on the postal fee: VAT owed is exactly the VAT on our fees.
    expect(await balanceOf(prisma, { type: 'vat_payable' })).toBe(-vat);
    const month = cairoDay(new Date()).slice(0, 7);
    const report = await vatReport(prisma, Number(month.slice(0, 4)));
    expect(report.months.find((m) => m.month === month)!.outputPiastres).toBe(vat);
    expect(report.total.inputPiastres).toBe(0);
    const ret = await vatReturn(prisma, month);
    expect(ret.salesPiastres).toBe(fees);
    expect(ret.outputVatPiastres).toBe(vat);
    expect(ret.purchasesPiastres).toBe(0);

    // A cost of the merchant in merchant profit.
    const profit = await merchantProfitability(prisma, { month, merchantId: f.merchant.id });
    expect(profit.rows[0]!.costs.postalFeePiastres).toBe(postal);
    expect(profit.rows[0]!.costs.otherDirectPiastres).toBe(0);

    // Posting the delivery again changes nothing.
    await prisma.$transaction((tx) =>
      postDeliveryCompleted(tx, { deliveryId: delivery.id, actorUserId: admin, now: new Date() }),
    );
    expect(await postalEntries()).toHaveLength(1);
    expect(await balanceOf(prisma, { type: 'postal_fee_payable' })).toBe(-postal);
  });

  it('books 10% of the failed delivery fee on every charged failed attempt', async () => {
    const { delivery } = await outForDelivery(1);
    await failDelivery(prisma, { deliveryId: delivery.id, riderUserId, reason: 'wrong_address' });
    const entries = await postalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.idempotencyKey).toBe(`delivery:${delivery.id}:failed_postal_fee`);
    expect(entries[0]!.data).toMatchObject({ basePiastres: 2505, bp: 1000 });
    expect(await balanceOf(prisma, { type: 'postal_fee_expense' })).toBe(251); // 250.5 up

    // Once per attempt.
    await prisma.$transaction((tx) =>
      postDeliveryFailed(tx, { deliveryId: delivery.id, actorUserId: admin, now: new Date() }),
    );
    expect(await postalEntries()).toHaveLength(1);
    // The merchant paid the failed fee plus VAT only.
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-(2505 + share(2505, 1400)));
  });

  it('books nothing when the rate is 0 or no fee was charged', async () => {
    await set('fee.postal_bp', 0);
    const { delivery } = await outForDelivery(1);
    await failDelivery(prisma, { deliveryId: delivery.id, riderUserId, reason: 'wrong_address' });
    expect(await postalEntries()).toHaveLength(0);
  });

  it('is paid from Taxes, never more than owed, and listed in payments due', async () => {
    await post(prisma, {
      kind: 'test_capital',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'bank' }, amount: 1_000_000 },
        { account: { type: 'retained_earnings' }, amount: -1_000_000 },
      ],
    });
    const { delivery } = await outForDelivery(1);
    await failDelivery(prisma, { deliveryId: delivery.id, riderUserId, reason: 'wrong_address' });
    expect((await taxesOwed(prisma)).postalPiastres).toBe(251);

    // Owed this month: due at the end of next month (the taxes' rule).
    const today = cairoDay(new Date());
    const due = await paymentsDue(prisma, new Date(), {
      stores: null,
      days: 90,
      kinds: ['postal'],
    });
    expect(due.items).toHaveLength(1);
    expect(due.items[0]).toMatchObject({
      kind: 'postal',
      amountPiastres: 251,
      dueDay: monthEnd(shiftDayByMonths(`${today.slice(0, 7)}-01`, 1)),
      href: '/finance/taxes',
      label: today.slice(0, 7),
    });
    // Not mixed into the taxes.
    const taxes = await paymentsDue(prisma, new Date(), { stores: null, days: 90, kinds: ['tax'] });
    expect(taxes.items.some((i) => i.id.startsWith('postal'))).toBe(false);

    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    const pay = (amountPiastres: number) =>
      payTax(prisma, {
        tax: 'postal',
        amountPiastres,
        moneyAccountId: bank.id,
        reference: 'Post office',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await expect(pay(252)).rejects.toThrow(/more_than_owed/);
    const entry = await pay(251);
    expect(entry.kind).toBe('tax_payment');
    expect(entry.data).toMatchObject({ tax: 'postal' });
    expect((await taxesOwed(prisma)).postalPiastres).toBe(0);
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(1_000_000 - 251);
    // The VAT report's payments are VAT only.
    const year = Number(today.slice(0, 4));
    expect((await vatReport(prisma, year)).total.paidPiastres).toBe(0);
    const after = await paymentsDue(prisma, new Date(), {
      stores: null,
      days: 90,
      kinds: ['postal'],
    });
    expect(after.items).toHaveLength(0);
  });
});

describe('postal fee on the other fees', () => {
  const postalOf = async (key: string) =>
    prisma.ledgerEntry.findUnique({ where: { idempotencyKey: key }, include: { lines: true } });

  it('books 10% of the receiving fee when a shipment is closed, once', async () => {
    await set('fee.receiving_per_unit_piastres', 155);
    const m = await createManifest(prisma, {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      reference: 'PO-1',
      lines: [{ skuId: f.sku.id, expectedQty: 3 }],
      actorUserId: admin,
    });
    await receiveOnManifest(prisma, {
      manifestId: m.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 3,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await closeManifest(prisma, { manifestId: m.id, darkStoreId: f.store.id, actorUserId: admin });
    // 3 × 1.55 = 4.65 EGP of fees: 46.5 piastres round up to 47.
    const entry = await postalOf(`manifest:${m.id}:receiving_fee:postal_fee`);
    expect(entry).not.toBeNull();
    expect(entry!.data).toMatchObject({ basePiastres: 465, bp: 1000 });
    for (const l of entry!.lines) {
      expect(l.darkStoreId).toBe(f.store.id);
      expect(l.merchantId).toBe(f.merchant.id);
    }
    expect(await balanceOf(prisma, { type: 'postal_fee_expense' })).toBe(47);
    // The merchant pays the fee plus VAT only.
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-(465 + share(465, 1400)));
  });

  it('books 10% of each storage day with the storage fee, once', async () => {
    // 3,100 a unit a month, 31 days in March: 100 a unit a day; 20 units: 20.00 EGP.
    await set('fee.storage_per_unit_month_piastres', 3100);
    await accrueStorage(prisma, '2026-03-10');
    await accrueStorage(prisma, '2026-03-10');
    const entries = await postalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.idempotencyKey).toBe(
      `storage:2026-03-10:${f.store.id}:${f.merchant.id}:postal_fee`,
    );
    expect(entries[0]!.occurredAt.toISOString()).toBe('2026-03-10T21:59:59.999Z');
    expect(entries[0]!.lines.every((l) => l.merchantId === f.merchant.id)).toBe(true);
    expect(await balanceOf(prisma, { type: 'postal_fee_expense' })).toBe(200);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-(2000 + share(2000, 1400)));
  });

  it('books 10% of the return fee when the parcel is handed over', async () => {
    await set('fee.return_per_unit_piastres', 300);
    const ret = await createReturn(prisma, {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      lines: [{ skuId: f.sku.id, source: 'sellable', quantity: 2 }],
      actorUserId: admin,
    });
    await pickForReturn(prisma, {
      returnId: ret.id,
      darkStoreId: f.store.id,
      skuId: f.sku.id,
      quantity: 2,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await handOverReturn(prisma, {
      returnId: ret.id,
      darkStoreId: f.store.id,
      collectedBy: 'Driver',
      actorUserId: admin,
    });
    const entry = await postalOf(`return:${ret.id}:return_fee:postal_fee`);
    expect(entry!.data).toMatchObject({ basePiastres: 600, bp: 1000 });
    expect(await balanceOf(prisma, { type: 'postal_fee_expense' })).toBe(60);
    expect(await balanceOf(prisma, { type: 'postal_fee_payable' })).toBe(-60);
  });
});
