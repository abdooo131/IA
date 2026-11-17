import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  balanceOf,
  cashPosition,
  checkRiderCashOverdue,
  closeBooks,
  decideFinanceRequest,
  ensureDefaultAccounts,
  listPettyCash,
  markMonthEndItem,
  monthEndChecklist,
  recordCashHandover,
  reversePettyCash,
  setPettyCategory,
  storeRiderCash,
  submitPettyCash,
  unmarkMonthEndItem,
} from '../src/finance';
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
let other: string;
let staff: string;
let riderUserId: string;
let riderId: string;
let n = 0;
const key = () => `k-${++n}-${Math.random()}`;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  await ensureDefaultAccounts(prisma);
  const user = (email: string, role: 'admin' | 'finance' | 'store_staff') =>
    prisma.user.create({ data: { email, name: email, role, passwordHash: 'x' } });
  admin = (await user('a@t.eg', 'admin')).id;
  other = (await user('f@t.eg', 'finance')).id;
  staff = (await user('s@t.eg', 'store_staff')).id;
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
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 50 });
});

afterAll(() => prisma.$disconnect());

const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });

/** An order of `qty` units (10.00 EGP each, 30.00 EGP delivery) packed and ready to hand over. */
async function packed(qty: number, paymentMethod: 'cod' | 'prepaid' = 'cod') {
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
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

async function deliver(qty: number) {
  const order = await packed(qty);
  await handToRider(prisma, {
    orderId: order.id,
    darkStoreId: f.store.id,
    badgeCode: 'RDR-1',
    actorUserId: admin,
  });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: order.id } });
  await completeDelivery(prisma, {
    deliveryId: delivery.id,
    riderUserId,
    otp: order.deliveryOtp,
    codCollectedPiastres: order.codAmountPiastres,
  });
  return order;
}

const receipt = () =>
  savePhoto(prisma, {
    kind: 'receipt',
    contentType: 'image/jpeg',
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    actorUserId: staff,
  });

describe('rider cash limit', () => {
  it('refuses a cash order past the limit unless a manager gives a reason', async () => {
    const first = await deliver(2); // 20 + 30 EGP in the rider's hands
    const cash = first.codAmountPiastres;
    await set('finance.rider_cash_limit_piastres', cash + 1000);
    const next = await packed(1);
    const ids = {
      orderId: next.id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
    };
    const refused = await handToRider(prisma, ids).catch((e: unknown) => e);
    expect(refused).toMatchObject({
      code: 'rider_cash_limit',
      details: {
        limitPiastres: cash + 1000,
        cashPiastres: cash,
        carryingPiastres: 0,
        orderCodPiastres: next.codAmountPiastres,
        totalPiastres: cash + next.codAmountPiastres,
      },
    });
    // A short reason is not enough.
    await expect(handToRider(prisma, { ...ids, cashOverrideReason: 'ok' })).rejects.toMatchObject({
      code: 'rider_cash_limit',
    });
    const done = await handToRider(prisma, {
      ...ids,
      cashOverrideReason: 'Manager allowed: last trip',
    });
    expect(done.rider).toBe('Rider');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'order.rider_cash_override', entityId: next.id },
    });
    expect(audit.after).toMatchObject({ reason: 'Manager allowed: last trip' });
    const event = await prisma.orderEvent.findFirstOrThrow({
      where: { orderId: next.id, type: 'handed_to_rider' },
    });
    expect(event.data).toMatchObject({ cashOverride: 'Manager allowed: last trip' });
  });

  it('counts the cash on delivery of orders already carried, skips prepaid orders and 0', async () => {
    const a = await packed(1);
    await set('finance.rider_cash_limit_piastres', a.codAmountPiastres + 100);
    await handToRider(prisma, {
      orderId: a.id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
    });
    const b = await packed(1);
    await expect(
      handToRider(prisma, {
        orderId: b.id,
        darkStoreId: f.store.id,
        badgeCode: 'RDR-1',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({
      code: 'rider_cash_limit',
      details: { carryingPiastres: a.codAmountPiastres },
    });
    // Prepaid orders carry no cash.
    await set('delivery.max_orders_per_trip', 3);
    const paid = await packed(1, 'prepaid');
    await handToRider(prisma, {
      orderId: paid.id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
    });
    // A store value of 0 turns the limit off for that store.
    await set('finance.rider_cash_limit_piastres', 0, f.store.id);
    await handToRider(prisma, {
      orderId: b.id,
      darkStoreId: f.store.id,
      badgeCode: 'RDR-1',
      actorUserId: admin,
    });
  });
});

describe('rider cash age', () => {
  it('raises one overdue alert per rider and day and shows it at the store', async () => {
    const order = await deliver(1);
    const later = new Date(Date.now() + 13 * 3_600_000);
    expect(await checkRiderCashOverdue(prisma, new Date())).toEqual({ raised: 0 });
    expect(await checkRiderCashOverdue(prisma, later)).toEqual({ raised: 1 });
    expect(await checkRiderCashOverdue(prisma, later)).toEqual({ raised: 0 });
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'rider_cash_overdue' } });
    expect(alert.darkStoreId).toBe(f.store.id);
    expect(alert.data).toMatchObject({
      riderId,
      amountPiastres: order.codAmountPiastres,
      hours: 12,
    });
    const store = await storeRiderCash(prisma, f.store.id, later);
    expect(store.riders).toEqual([
      expect.objectContaining({ riderId, cashPiastres: order.codAmountPiastres, overdue: true }),
    ]);
    // Handed in: nothing more is raised.
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: order.codAmountPiastres,
      receivedById: staff,
      idempotencyKey: key(),
    });
    expect(await checkRiderCashOverdue(prisma, new Date(later.getTime() + 86_400_000))).toEqual({
      raised: 0,
    });
  });

  it('splits rider cash by age in the cash position, newest cash last handed in', async () => {
    const first = await deliver(1);
    const second = await deliver(2);
    // Seen 13 hours after the first collection, both collections are past the 12 hours.
    const lines = await prisma.ledgerLine.findMany({
      where: { account: { key: `rider_cash:${riderId}` }, amountPiastres: { gt: 0 } },
      orderBy: { occurredAt: 'asc' },
    });
    const now = new Date();
    // ledger_lines are append only: move the clock instead of the rows.
    const at = (h: number) => new Date(lines[0]!.occurredAt.getTime() + h * 3_600_000);
    const position = await cashPosition(prisma, { stores: null, now: at(13) });
    const row = position.riders.rows[0]!;
    expect(row.cashPiastres).toBe(first.codAmountPiastres + second.codAmountPiastres);
    expect(row.overduePiastres).toBe(first.codAmountPiastres + second.codAmountPiastres);
    const fresh = await cashPosition(prisma, { stores: null, now });
    expect(fresh.riders.freshPiastres).toBe(first.codAmountPiastres + second.codAmountPiastres);
    // Half handed in: what is left is the newest money.
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: first.codAmountPiastres,
      receivedById: staff,
      idempotencyKey: key(),
    });
    const after = await cashPosition(prisma, { stores: null, now });
    expect(after.riders.totalPiastres).toBe(second.codAmountPiastres);
    const box = after.money.rows.find((a) => a.kind === 'store_box');
    expect(box?.balancePiastres).toBe(first.codAmountPiastres);
    // We owe the merchant the cash collected, less fees.
    expect(after.merchants!.rows[0]!.owedPiastres).toBeGreaterThan(0);
    expect(after.netPiastres).toBe(
      after.money.totalPiastres +
        after.riders.totalPiastres -
        after.merchants!.totalPiastres -
        after.bills!.totalPiastres,
    );
    // Limited to another store: nothing of this store, and no company wide parts.
    const limited = await cashPosition(prisma, { stores: [f.other.id], now });
    expect(limited.riders.rows).toEqual([]);
    expect(limited.money.rows).toEqual([]);
    expect(limited.merchants).toBeNull();
    expect(limited.netPiastres).toBeNull();
  });
});

describe('petty cash', () => {
  let category: string;
  beforeEach(async () => {
    category = (
      await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'expense:packaging' } })
    ).id;
    // 40.00 EGP in the store box from a rider handover.
    await set('finance.rider_cash_limit_piastres', 0);
    await deliver(1);
    const cash = await balanceOf(prisma, { type: 'rider_cash', riderId });
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: cash,
      receivedById: staff,
      idempotencyKey: key(),
    });
    await set('finance.petty_cash_float_piastres', 0);
  });

  const submit = async (amount: number, extra: Partial<{ idempotencyKey: string }> = {}) =>
    submitPettyCash(prisma, {
      darkStoreId: f.store.id,
      expenseAccountId: category,
      amountPiastres: amount,
      note: 'Tape and boxes',
      photoId: (await receipt()).id,
      actorUserId: staff,
      idempotencyKey: extra.idempotencyKey ?? key(),
    });

  it('needs a petty category and a receipt photo, and never takes more than the box holds', async () => {
    await expect(submit(1000)).rejects.toMatchObject({ code: 'petty_category_not_found' });
    await setPettyCategory(prisma, { accountId: category, petty: true, actorUserId: other });
    await expect(
      submitPettyCash(prisma, {
        darkStoreId: f.store.id,
        expenseAccountId: category,
        amountPiastres: 1000,
        note: 'Tape',
        photoId: (
          await savePhoto(prisma, {
            kind: 'pack',
            contentType: 'image/jpeg',
            data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
            actorUserId: staff,
          })
        ).id,
        actorUserId: staff,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'receipt_required' });
    const box = await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id });
    await expect(submit(box + 1)).rejects.toMatchObject({
      code: 'not_enough_cash_in_box',
      details: { boxPiastres: box },
    });
  });

  it('posts a small expense at once against the store box, once per key, and finance can reverse it', async () => {
    await setPettyCategory(prisma, { accountId: category, petty: true, actorUserId: other });
    const box = await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id });
    const k = key();
    const result = await submit(1500, { idempotencyKey: k });
    expect(result.status).toBe('posted');
    expect(await submit(1500, { idempotencyKey: k })).toEqual(result);
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(
      box - 1500,
    );
    const [row] = await listPettyCash(prisma, { darkStoreId: f.store.id });
    expect(row).toMatchObject({ label: 'PC-000001', status: 'posted', amountPiastres: 1500 });
    const lines = await prisma.ledgerLine.findMany({
      where: { entry: { kind: 'petty_cash' } },
    });
    expect(lines.every((l) => l.darkStoreId === f.store.id)).toBe(true);
    // The receipt is on the entry, so it never shows as missing.
    expect(await prisma.financeReceipt.count({ where: { entryId: lines[0]!.entryId } })).toBe(1);

    await expect(
      reversePettyCash(prisma, { pettyCashId: row!.id, reason: 'no', actorUserId: other }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await reversePettyCash(prisma, {
      pettyCashId: row!.id,
      reason: 'Paid twice by mistake',
      actorUserId: other,
    });
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(box);
    await expect(
      reversePettyCash(prisma, {
        pettyCashId: row!.id,
        reason: 'Again please',
        actorUserId: other,
      }),
    ).rejects.toMatchObject({ code: 'petty_cash_reversed' });
    expect((await listPettyCash(prisma, { status: 'reversed' })).length).toBe(1);
  });

  it('waits for a second person above the limit or below the float', async () => {
    await setPettyCategory(prisma, { accountId: category, petty: true, actorUserId: other });
    await set('finance.petty_cash_limit_piastres', 1000);
    const box = await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id });
    const big = await submit(1001);
    expect(big.status).toBe('pending');
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(box);
    const request = await prisma.financeRequest.findFirstOrThrow({ where: { kind: 'petty_cash' } });
    // Whoever asked never decides it.
    await expect(
      decideFinanceRequest(prisma, { requestId: request.id, approve: true, actorUserId: staff }),
    ).rejects.toMatchObject({ code: 'same_person' });
    await decideFinanceRequest(prisma, {
      requestId: request.id,
      approve: true,
      actorUserId: other,
    });
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(
      box - 1001,
    );
    expect((await listPettyCash(prisma, {}))[0]!.status).toBe('posted');

    // Below the float: waits even when small; rejected ones never move money.
    await set('finance.petty_cash_float_piastres', box);
    const small = await submit(100);
    expect(small.status).toBe('pending');
    const second = await prisma.financeRequest.findFirstOrThrow({
      where: { kind: 'petty_cash', status: 'pending' },
    });
    await decideFinanceRequest(prisma, {
      requestId: second.id,
      approve: false,
      note: 'Buy it from the hub',
      actorUserId: other,
    });
    expect((await listPettyCash(prisma, { status: 'rejected' })).length).toBe(1);
    expect(await balanceOf(prisma, { type: 'store_cash', darkStoreId: f.store.id })).toBe(
      box - 1001,
    );
  });
});

describe('month end checklist', () => {
  it('lists what is left, takes hand ticks with a note and knows when the books are closed', async () => {
    // A month that is over: last month.
    const today = new Date();
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
    const month = d.toISOString().slice(0, 7);
    const order = await deliver(1);
    // A short handover waits for finance.
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: order.codAmountPiastres - 100,
      receivedById: staff,
      idempotencyKey: key(),
    });
    // This month: the difference waits for finance and the rider still holds 1.00 EGP.
    const current = today.toISOString().slice(0, 7);
    const now = await monthEndChecklist(prisma, current);
    expect(now.over).toBe(false);
    expect(now.items.find((i) => i.id === 'cash_handovers')!.left).toBe(2);
    expect(now.items.find((i) => i.id === 'invoices')!.notYet).toBe(true);

    let list = await monthEndChecklist(prisma, month);
    const item = (id: string) => list.items.find((i) => i.id === id)!;
    expect(list.over).toBe(true);
    expect(item('cash_handovers').left).toBe(0);
    expect(item('cash_handovers').done).toBe(true);
    expect(item('vat_return')).toMatchObject({ automatic: false, done: false });
    expect(item('books_closed').done).toBe(false);
    expect(list.readyToClose).toBe(false);

    await expect(
      markMonthEndItem(prisma, { month, item: 'books_closed', note: 'done', actorUserId: other }),
    ).rejects.toMatchObject({ code: 'invalid_item' });
    await markMonthEndItem(prisma, {
      month,
      item: 'vat_return',
      note: 'Filed on the portal',
      actorUserId: other,
    });
    list = await monthEndChecklist(prisma, month);
    expect(item('vat_return')).toMatchObject({ done: true, mark: { note: 'Filed on the portal' } });
    expect(
      await prisma.auditLog.count({ where: { action: 'finance.month_end_mark', entityId: month } }),
    ).toBe(1);
    await unmarkMonthEndItem(prisma, { month, item: 'vat_return', actorUserId: other });
    list = await monthEndChecklist(prisma, month);
    expect(item('vat_return').done).toBe(false);

    await closeBooks(prisma, { day: list.lastDay, actorUserId: admin, actorRole: 'admin' });
    list = await monthEndChecklist(prisma, month);
    expect(item('books_closed').done).toBe(true);

    await expect(monthEndChecklist(prisma, '2026-13')).rejects.toMatchObject({
      code: 'invalid_month',
    });
  });
});
