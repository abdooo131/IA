import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  accrueStorage,
  balanceOf,
  cancelPayout,
  createPayout,
  financeWallets,
  markPayoutPaid,
  merchantOwed,
  merchantStatement,
  payoutDueOn,
  payRiderBonus,
  post,
  recordBankDeposit,
  recordCashHandover,
  recordMerchantAdjustment,
  reviewCashHandover,
  riderBonusOwed,
  riderCash,
  share,
  trialBalance,
} from '../src/finance';
import { closeManifest, createManifest, receiveOnManifest } from '../src/inbound';
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

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let riderUserId: string;
let riderId: string;
let n = 0;
const key = () => `k-${++n}-${Math.random()}`;

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
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 20 });
});

afterAll(() => prisma.$disconnect());

const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });

/** Takes an order of `qty` units of SKU-1 (10.00 EGP each) out for delivery. */
async function outForDelivery(qty: number, paymentMethod: 'cod' | 'prepaid' = 'cod') {
  const order = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod,
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

async function deliver(qty: number, cash?: number) {
  const { order, delivery } = await outForDelivery(qty);
  await completeDelivery(prisma, {
    deliveryId: delivery.id,
    riderUserId,
    otp: order.deliveryOtp,
    codCollectedPiastres: cash ?? order.codAmountPiastres,
  });
  return order;
}

describe('ledger', () => {
  it('rounds shares half up in whole piastres', () => {
    expect(share(10_000, 250)).toBe(250);
    expect(share(333, 150)).toBe(5); // 4.995 rounds to 5
    expect(share(0, 1400)).toBe(0);
  });

  it('refuses unbalanced entries, posts once per key and never changes history', async () => {
    await expect(
      post(prisma, {
        kind: 'test',
        idempotencyKey: 'x',
        lines: [
          { account: { type: 'bank' }, amount: 100 },
          { account: { type: 'revenue' }, amount: -99 },
        ],
      }),
    ).rejects.toThrow(/unbalanced/);

    const lines = [
      { account: { type: 'bank' } as const, amount: 100 },
      { account: { type: 'revenue' } as const, amount: -100 },
    ];
    const first = await post(prisma, { kind: 'test', idempotencyKey: 'once', lines });
    const again = await post(prisma, { kind: 'test', idempotencyKey: 'once', lines });
    expect(again!.id).toBe(first!.id);
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(100);

    await expect(prisma.ledgerLine.updateMany({ data: { amountPiastres: 5 } })).rejects.toThrow(
      /append only/,
    );
    await expect(prisma.ledgerEntry.deleteMany({})).rejects.toThrow(/append only/);
  });

  it('is checked by the database too: a lone line cannot be committed', async () => {
    const entry = await post(prisma, {
      kind: 'test',
      idempotencyKey: 'pair',
      lines: [
        { account: { type: 'bank' }, amount: 50 },
        { account: { type: 'revenue' }, amount: -50 },
      ],
    });
    const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await expect(
      prisma.ledgerLine.create({
        data: {
          entryId: entry!.id,
          accountId: account.id,
          amountPiastres: 7,
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow(/does not balance/);
  });
});

describe('fees on orders', () => {
  beforeEach(async () => {
    await set('fee.order_fixed_piastres', 4500);
    await set('fee.order_percent_bp', 200);
    await set('fee.cod_percent_bp', 100);
    await set('fee.vat_bp', 1400);
    await set('rider.bonus_per_delivery_piastres', 1000);
    await set('fee.failed_delivery_piastres', 2500);
  });

  it('books cash, fees, VAT and the rider bonus when an order is delivered', async () => {
    // 3 units of 10.00 EGP plus 30.00 delivery: the rider collects 60.00 EGP.
    const order = await deliver(3);
    expect(order.codAmountPiastres).toBe(6000);
    // Order fee 45.00 + 2% of 30.00 = 45.60; COD fee 1% of 60.00 = 0.60; VAT 14% on each.
    const orderFee = 4500 + 60;
    const codFee = 60;
    const vat = share(orderFee, 1400) + share(codFee, 1400);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(6000 - orderFee - codFee - vat);
    expect(await riderCash(prisma, riderId)).toBe(6000);
    expect(await riderBonusOwed(prisma, riderId)).toBe(1000);
    expect(-(await balanceOf(prisma, { type: 'revenue' }))).toBe(orderFee + codFee);
    expect(-(await balanceOf(prisma, { type: 'vat_payable' }))).toBe(vat);

    const tb = await trialBalance(prisma);
    expect(tb.totalDebitPiastres).toBe(tb.totalCreditPiastres);
  });

  it('uses a merchant own fee when one is set', async () => {
    await set('fee.order_fixed_piastres', 2000, `merchant:${f.merchant.id}`);
    await deliver(1);
    const fee = await prisma.ledgerEntry.findFirstOrThrow({ where: { kind: 'order_fee' } });
    expect(fee.data).toMatchObject({ fixedPiastres: 2000 });
  });

  it('charges the failed delivery fee and leaves no cash with the rider', async () => {
    const { delivery } = await outForDelivery(1);
    await failDelivery(prisma, { deliveryId: delivery.id, riderUserId, reason: 'no_answer' });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-(2500 + share(2500, 1400)));
    expect(await riderCash(prisma, riderId)).toBe(0);
  });

  it('charges receiving per unit when a shipment is closed', async () => {
    await set('fee.receiving_per_unit_piastres', 150);
    const m = await createManifest(prisma, {
      merchantId: f.merchant.id,
      darkStoreId: f.store.id,
      reference: 'PO-1',
      lines: [{ skuId: f.sku.id, expectedQty: 4 }],
      actorUserId: admin,
    });
    for (let i = 0; i < 4; i++)
      await receiveOnManifest(prisma, {
        manifestId: m.id,
        darkStoreId: f.store.id,
        skuId: f.sku.id,
        quantity: 1,
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await closeManifest(prisma, { manifestId: m.id, darkStoreId: f.store.id, actorUserId: admin });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-(600 + share(600, 1400)));
  });

  it('charges storage once per day on units in stock', async () => {
    // 3,100 piastres a unit a month, 31 days in March: 100 piastres a unit a day; 20 units.
    await set('fee.storage_per_unit_month_piastres', 3100);
    await set('fee.vat_bp', 0);
    expect(await accrueStorage(prisma, '2026-03-10')).toEqual({ day: '2026-03-10', charged: 1 });
    expect(await accrueStorage(prisma, '2026-03-10')).toEqual({ day: '2026-03-10', charged: 1 });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-2000);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { kind: 'storage_fee' } });
    expect(entry.occurredAt.toISOString()).toBe('2026-03-10T21:59:59.999Z');
  });
});

describe('cash', () => {
  it('moves counted cash to the store and sends differences to finance', async () => {
    await deliver(2); // 50.00 EGP collected
    const balanced = await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 5000,
      receivedById: admin,
      idempotencyKey: 'h1',
    });
    expect(balanced.status).toBe('balanced');
    expect(await riderCash(prisma, riderId)).toBe(0);
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(5000);

    await deliver(2);
    const short = await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 4800,
      receivedById: admin,
      idempotencyKey: 'h2',
    });
    expect(short).toMatchObject({
      status: 'pending',
      expectedPiastres: 5000,
      differencePiastres: 200,
    });
    expect(await riderCash(prisma, riderId)).toBe(200);
    // Same key again is the same handover, not a second one.
    const replay = await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 4800,
      receivedById: admin,
      idempotencyKey: 'h2',
    });
    expect(replay.id).toBe(short.id);

    await reviewCashHandover(prisma, {
      handoverId: short.id,
      decision: 'write_off',
      note: 'Counted twice',
      actorUserId: admin,
    });
    expect(await riderCash(prisma, riderId)).toBe(0);
    expect(await balanceOf(prisma, { type: 'cash_difference' })).toBe(200);
    await expect(
      reviewCashHandover(prisma, {
        handoverId: short.id,
        decision: 'write_off',
        note: 'again',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'handover_not_pending' });

    await expect(
      recordBankDeposit(prisma, {
        darkStoreId: f.store.id,
        amountPiastres: 99_999,
        reference: 'DEP-1',
        actorUserId: admin,
        idempotencyKey: 'd1',
      }),
    ).rejects.toMatchObject({ code: 'more_than_cash_in_store' });
    await recordBankDeposit(prisma, {
      darkStoreId: f.store.id,
      amountPiastres: 9800,
      reference: 'DEP-1',
      actorUserId: admin,
      idempotencyKey: 'd1',
    });
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(0);
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(9800);
  });

  it('can leave a shortage on the rider to recover later', async () => {
    await deliver(2);
    const short = await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 4000,
      receivedById: admin,
      idempotencyKey: 'h3',
    });
    await reviewCashHandover(prisma, {
      handoverId: short.id,
      decision: 'charge_rider',
      note: 'Will bring it',
      actorUserId: admin,
    });
    expect(await riderCash(prisma, riderId)).toBe(1000);
  });
});

describe('merchant payouts and rider bonuses', () => {
  it('pays what is owed once, after finance marks it paid', async () => {
    await expect(
      createPayout(prisma, { merchantId: f.merchant.id, cutoffAt: new Date(), actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'nothing_to_pay' });
    await deliver(4); // 70.00 EGP collected, no fees configured
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    expect(payout.amountPiastres).toBe(7000);
    await expect(
      createPayout(prisma, { merchantId: f.merchant.id, cutoffAt: new Date(), actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'payout_already_open' });
    // Nothing moves before it is paid.
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(7000);
    await markPayoutPaid(prisma, { payoutId: payout.id, reference: 'TRX-55', actorUserId: admin });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(-7000);
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, reference: 'TRX-55', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'payout_not_draft' });

    await deliver(1);
    const second = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    await cancelPayout(prisma, { payoutId: second.id, note: 'Bank holiday', actorUserId: admin });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(4000);
  });

  it('writes a statement whose lines add up to the closing balance', async () => {
    await set('fee.order_fixed_piastres', 1000);
    const from = new Date(Date.now() - 60_000);
    await deliver(1);
    await recordMerchantAdjustment(prisma, {
      merchantId: f.merchant.id,
      amountPiastres: 500,
      reason: 'Goodwill credit for a late order',
      actorUserId: admin,
      idempotencyKey: 'adj1',
    });
    const statement = await merchantStatement(
      prisma,
      f.merchant.id,
      from,
      new Date(Date.now() + 60_000),
    );
    expect(statement.openingOwedPiastres).toBe(0);
    expect(statement.byKind).toEqual({ cod_collected: 4000, order_fee: -1000, adjustment: 500 });
    expect(statement.closingOwedPiastres).toBe(3500);
    expect(statement.lines.at(-1)!.balanceAfterPiastres).toBe(3500);
  });

  it('pays rider bonuses up to what was earned', async () => {
    await set('rider.bonus_per_delivery_piastres', 1500);
    await deliver(1);
    await expect(
      payRiderBonus(prisma, {
        riderId,
        amountPiastres: 2000,
        from: 'bank',
        reference: 'B1',
        actorUserId: admin,
        idempotencyKey: 'b1',
      }),
    ).rejects.toMatchObject({ code: 'more_than_owed' });
    await payRiderBonus(prisma, {
      riderId,
      amountPiastres: 1500,
      from: 'bank',
      reference: 'B1',
      actorUserId: admin,
      idempotencyKey: 'b1',
    });
    expect(await riderBonusOwed(prisma, riderId)).toBe(0);

    const wallets = await financeWallets(prisma);
    expect(wallets.riders[0]).toMatchObject({ bonusOwedPiastres: 0, cashPiastres: 4000 });
    expect(wallets.totals).toMatchObject({
      cashWithRidersPiastres: 4000,
      owedToMerchantsPiastres: 4000,
    });
    expect(wallets.company.riderBonusExpensePiastres).toBe(1500);
  });

  it('knows which merchants are due on which weekday', () => {
    expect(payoutDueOn('daily', 2)).toBe(true);
    expect([0, 1, 2, 3, 4, 5, 6].filter((d) => payoutDueOn('twice_weekly', d))).toEqual([0, 3]);
    expect([0, 1, 2, 3, 4, 5, 6].filter((d) => payoutDueOn('weekly', d))).toEqual([0]);
  });
});
