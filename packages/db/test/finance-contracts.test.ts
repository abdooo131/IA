import {
  addDays,
  cairoDay,
  contractVersionSchema,
  type ContractVersionInput,
  whatIf,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  activateContractVersion,
  balanceOf,
  chargeMinimumFees,
  createContractDraft,
  depositHeld,
  ensureDefaultAccounts,
  getContract,
  merchantOwed,
  merchantProfitability,
  merchantProfitDetail,
  post,
  recordCapital,
  recordDeposit,
  recordExpense,
  recordMerchantAdjustment,
  submitDeposit,
} from '../src/finance';
import { createManifest } from '../src/inbound';
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

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let riderUserId: string;
let n = 0;
const key = () => `ctr-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  riderUserId = (
    await createUser(prisma, {
      email: 'r@t.eg',
      name: 'Rider',
      role: 'rider',
      password: 'long-password-1',
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
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
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 20 });
});

afterAll(() => prisma.$disconnect());

/** Delivers one order of `qty` units of SKU-1 (10.00 EGP each), cash on delivery. */
async function deliver(qty: number) {
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
  await completeDelivery(prisma, {
    deliveryId: delivery.id,
    riderUserId,
    otp: full.deliveryOtp,
    codCollectedPiastres: full.codAmountPiastres,
  });
  return full;
}

const orderFees = async () =>
  (
    await prisma.ledgerEntry.findMany({
      where: { kind: 'order_fee' },
      orderBy: { number: 'asc' },
      include: { lines: { include: { account: true } } },
    })
  ).map((e) => -e.lines.find((l) => l.account.type === 'revenue')!.amountPiastres);

/** A contract version made and activated, in force from 60 days ago. */
async function contract(over: Partial<ContractVersionInput> = {}) {
  const body = contractVersionSchema.parse({
    orderFixedPiastres: null,
    orderPercentBp: null,
    codPercentBp: null,
    failedDeliveryPiastres: null,
    receivingPerUnitPiastres: null,
    storagePerUnitMonthPiastres: null,
    returnPerUnitPiastres: null,
    payoutSchedule: null,
    minimumPayoutPiastres: null,
    promiseMinutes: null,
    deliveryAttempts: null,
    startDate: addDays(today(), -60),
    endDate: null,
    noticeDays: 30,
    minimumMonthlyFeePiastres: null,
    securityDepositPiastres: null,
    creditLimitPiastres: null,
    tiers: [],
    ...over,
  });
  const draft = await createContractDraft(prisma, {
    merchantId: f.merchant.id,
    body,
    actorUserId: admin,
  });
  return activateContractVersion(prisma, {
    merchantId: f.merchant.id,
    versionId: draft.id,
    effectiveFrom: addDays(today(), -60),
    actorUserId: admin,
    allowPast: true,
  });
}

describe('volume tiers', () => {
  it('charges the band of the order that crosses it and every later order, never earlier ones', async () => {
    await set('fee.order_fixed_piastres', 2000);
    await set('fee.order_percent_bp', 100);
    await contract({
      tiers: [
        { fromOrder: 1, fixedFeePiastres: 1500, percentBp: null },
        { fromOrder: 3, fixedFeePiastres: 1000, percentBp: 0 },
      ],
    });
    await deliver(1);
    await deliver(1);
    await deliver(1);
    await deliver(1);
    // Products 10 EGP: 1% is 10 piastres while the percentage comes from the setting.
    expect(await orderFees()).toEqual([1510, 1510, 1000, 1000]);
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { kind: 'order_fee' },
      orderBy: { number: 'desc' },
    });
    expect(entry.data).toMatchObject({ tierFrom: 3, nth: 4 });
    const view = await getContract(prisma, f.merchant.id);
    expect(view.deliveredThisMonth).toBe(4);
    expect(view.nextOrderTier).toMatchObject({ fromOrder: 3 });
  });

  it('uses the settings when no contract is in force', async () => {
    await set('fee.order_fixed_piastres', 2000);
    await contract({
      startDate: addDays(today(), 5),
      tiers: [{ fromOrder: 1, fixedFeePiastres: 1, percentBp: null }],
    });
    await deliver(1);
    expect(await orderFees()).toEqual([2000]);
  });
});

describe('monthly minimum', () => {
  it('tops last month up to the minimum once, with VAT', async () => {
    await set('fee.vat_bp', 1400);
    const thisMonth = today().slice(0, 7);
    const lastMonthFirst = addDays(`${thisMonth}-01`, -1).slice(0, 7) + '-01';
    await contract({ startDate: lastMonthFirst, minimumMonthlyFeePiastres: 100_000 });
    // 300 EGP of fees were booked last month.
    await post(prisma, {
      kind: 'storage_fee',
      idempotencyKey: key(),
      occurredAt: new Date(new Date(`${lastMonthFirst}T12:00:00Z`).getTime()),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 30_000 },
        { account: { type: 'revenue' }, amount: -30_000 },
      ],
    });
    const before = await merchantOwed(prisma, f.merchant.id);
    const first = await chargeMinimumFees(prisma, new Date());
    expect(first.charged).toBe(1);
    await chargeMinimumFees(prisma, new Date());
    const entries = await prisma.ledgerEntry.findMany({ where: { kind: 'minimum_fee' } });
    expect(entries).toHaveLength(1);
    // 1,000 minimum less 300 booked: 700 plus 14% VAT.
    expect(before - (await merchantOwed(prisma, f.merchant.id))).toBe(70_000 + 9_800);
    expect(entries[0]!.occurredAt < new Date(`${thisMonth}-01T00:00:00Z`)).toBe(true);
  });
});

describe('security deposit and credit limit', () => {
  it('holds a deposit in its own wallet and never pays back more than held', async () => {
    const pending = await submitDeposit(prisma, {
      merchantId: f.merchant.id,
      direction: 'in',
      via: 'bank',
      amountPiastres: 500_000,
      reference: 'Deposit',
      idempotencyKey: key(),
      actorUserId: admin,
    });
    // Money in waits for a second person while finance.approve_money_in is on.
    expect(pending.status).toBe('pending');
    await recordDeposit(prisma, {
      merchantId: f.merchant.id,
      direction: 'in',
      via: 'bank',
      amountPiastres: 500_000,
      reference: 'Deposit',
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(await depositHeld(prisma, f.merchant.id)).toBe(500_000);
    const wallet = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { key: `merchant_deposit:${f.merchant.id}` },
    });
    expect(wallet.code).toBe('2600-0001');
    await expect(
      recordDeposit(prisma, {
        merchantId: f.merchant.id,
        direction: 'out',
        via: 'bank',
        amountPiastres: 600_000,
        reference: 'Back',
        idempotencyKey: key(),
        actorUserId: admin,
      }),
    ).rejects.toThrow('more_than_deposit');
    // Paid back into the merchant's balance, it goes out with the next payout.
    await recordDeposit(prisma, {
      merchantId: f.merchant.id,
      direction: 'out',
      via: 'wallet',
      amountPiastres: 200_000,
      reference: 'Part back',
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(await depositHeld(prisma, f.merchant.id)).toBe(300_000);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(200_000);
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(10_500_000);
  });

  it('refuses new shipments over the credit limit and alerts once a day', async () => {
    await contract({ creditLimitPiastres: 50_000 });
    const shipment = (reference: string) =>
      createManifest(prisma, {
        merchantId: f.merchant.id,
        darkStoreId: f.store.id,
        reference,
        lines: [{ skuId: f.sku.id, expectedQty: 1 }],
        actorUserId: admin,
      });
    await recordMerchantAdjustment(prisma, {
      merchantId: f.merchant.id,
      amountPiastres: -50_000,
      reason: 'Fees owed',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // At the limit is still allowed.
    await shipment('ASN-1');
    await recordMerchantAdjustment(prisma, {
      merchantId: f.merchant.id,
      amountPiastres: -1,
      reason: 'One more piastre',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await expect(shipment('ASN-2')).rejects.toThrow('merchant_over_credit_limit');
    await expect(shipment('ASN-3')).rejects.toThrow('merchant_over_credit_limit');
    const alerts = await prisma.alert.findMany({ where: { type: 'merchant_over_credit_limit' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.merchantId).toBe(f.merchant.id);
    expect((await getContract(prisma, f.merchant.id)).overCreditLimit).toBe(true);
  });
});

describe('merchant profitability', () => {
  it('shares store costs by deliveries and rent by units stored', async () => {
    await set('fee.order_fixed_piastres', 2_000);
    await set('fee.cod_percent_bp', 100);
    await set('rider.bonus_per_delivery_piastres', 500);
    const other = await prisma.merchant.create({ data: { name: 'Other merchant' } });
    const otherSku = await prisma.sku.create({
      data: { merchantId: other.id, sku: 'OTH-1', titleEn: 'x', titleAr: 'x', pricePiastres: 500 },
    });
    await receive(prisma, { skuId: otherSku.id, binId: f.shelfB.id, quantity: 20 });
    await deliver(2);
    await deliver(2);
    const cib = await byKey('bank');
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: cib.id,
      amountPiastres: 40_000,
      memo: 'Rent',
      reference: 'Rent',
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:fuel')).id,
      paidFromAccountId: cib.id,
      amountPiastres: 6_000,
      memo: 'Fuel',
      reference: 'Fuel',
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const month = today().slice(0, 7);
    const { rows } = await merchantProfitability(prisma, { month });
    const mine = rows.find((r) => r.merchant.id === f.merchant.id)!;
    const theirs = rows.find((r) => r.merchant.id === other.id)!;
    expect(mine.deliveredOrders).toBe(2);
    // Two orders of 20 EGP: order fees 2 × 20, COD fee 1% of 2 × 50 EGP (with delivery).
    expect(mine.feesByKind).toEqual({ order_fee: 4_000, cod_fee: 100 });
    expect(mine.costs.riderBonusPiastres).toBe(1_000);
    // Only this merchant delivered: all the fuel is theirs.
    expect(mine.costs.storeCostsPiastres).toBe(6_000);
    // Rent by units held: 16 of ours against 20 of theirs.
    expect(mine.costs.storageSpacePiastres).toBe(Math.round((40_000 * 16) / 36));
    expect(theirs.costs.storageSpacePiastres).toBe(Math.round((40_000 * 20) / 36));
    expect(mine.marginPiastres).toBe(mine.feesPiastres - mine.costsPiastres);
    expect(mine.marginPerOrderPiastres).toBe(Math.round(mine.marginPiastres / 2));

    const detail = await merchantProfitDetail(prisma, { month, merchantId: f.merchant.id });
    expect(detail.current).toMatchObject({ orderFixedPiastres: 2_000, codPercentBp: 100 });
    // The same month with the current values gives the same margin.
    const same = whatIf(detail.base, detail.current);
    expect(same.marginPiastres).toBe(mine.marginPiastres);
    const higher = whatIf(detail.base, { ...detail.current, minimumPiastres: 100_000 });
    expect(higher.minimumTopUpPiastres).toBe(100_000 - 4_100);
    expect(higher.marginPiastres).toBe(100_000 - mine.costsPiastres);
  });
});
