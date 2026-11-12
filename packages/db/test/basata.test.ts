import { addDays, cairoDay, depositDeadline } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  approveBasataDeposit,
  balanceOf,
  cashPosition,
  cashToHandIn,
  checkRiderCashLimit,
  checkRiderCashOverdue,
  createSupplier,
  ensureDefaultAccounts,
  listFrozenRiders,
  post,
  recordBasataSettlement,
  recordCashHandover,
  rejectBasataDeposit,
  requestWithdrawal,
  riderBasata,
  runDepositDeadline,
  setRiderOffice,
  submitBasataDeposit,
  trialBalance,
  unfreezeRider,
  unsettledBasataDeposits,
} from '../src/finance';
import { JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { writeAccess } from '../src/access';
import { setEmployment } from '../src/hr-pay';
import { acceptOrder, createOrder, handToRider, packOrder, pickOrderItem } from '../src/orders';
import { savePhoto } from '../src/photos';
import {
  dispatchPush,
  type PushMessage,
  type PushOutcome,
  type PushSender,
  type PushTarget,
} from '../src/push';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

// Basata cash deposits (owner, 2026-11-11): riders deposit their cash at a Basata branch,
// Accounting reviews the receipt, Basata's daily transfer settles it, and cash still held at
// the deadline is taken from the rider, who is frozen until Accounting unfreezes them.

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let finance: string;
let riderUserId: string;
let riderId: string;
let officeId: string;
let n = 0;
const key = () => `bd-${++n}-${Math.random()}`;
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number, scope = 'global') =>
  changeSetting(prisma, { key: k, scope, value, actorUserId: admin });

/** A past Cairo day and its 23:00 deadline, so every test runs at fixed moments. */
const DAY = addDays(cairoDay(new Date()), -3);
const T = depositDeadline(DAY, 23);
const at = (minutesFromDeadline: number) => new Date(T.getTime() + minutesFromDeadline * 60_000);

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  finance = (
    await prisma.user.create({
      data: { email: 'f@t.eg', name: 'Finance', role: 'finance', passwordHash: 'x' },
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
  await ensureDefaultAccounts(prisma);
  officeId = (
    await createSupplier(prisma, { name: 'Fast Riders Office', whtBp: 0, actorUserId: admin })
  ).id;
  await setRiderOffice(prisma, {
    supplierId: officeId,
    isRiderOffice: true,
    commissionBp: 1000,
    actorUserId: admin,
  });
  // The deadline rule started the day before (its first run only marks the start).
  await startDeadlines(addDays(DAY, -1));
});

afterAll(() => prisma.$disconnect());

const startDeadlines = (day: string) =>
  prisma.cashDeadlineRun.create({
    data: {
      day: new Date(`${day}T00:00:00Z`),
      deadlineAt: depositDeadline(day, 23),
      skipped: true,
    },
  });

async function expectBalanced() {
  const tb = await trialBalance(prisma);
  expect(tb.totalDebitPiastres).toBe(tb.totalCreditPiastres);
}

/** The rider collected cash on delivery at a moment. */
const collect = (amount: number, when: Date) =>
  post(prisma, {
    kind: 'cod_collected',
    idempotencyKey: key(),
    occurredAt: when,
    lines: [
      { account: { type: 'rider_cash', riderId }, amount },
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -amount },
    ],
  });

const receipt = (by = riderUserId, kind: 'basata_receipt' | 'receipt' = 'basata_receipt') =>
  savePhoto(prisma, {
    kind,
    contentType: 'image/jpeg',
    data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    actorUserId: by,
  });

async function deposit(
  amount: number,
  when: Date,
  extra: { reference?: string; photoId?: string; idempotencyKey?: string } = {},
) {
  return submitBasataDeposit(prisma, {
    riderUserId,
    body: {
      amountPiastres: amount,
      reference: extra.reference ?? `REF-${++n}`,
      depositedAt: when.toISOString(),
      photoId: extra.photoId ?? (await receipt()).id,
      idempotencyKey: extra.idempotencyKey ?? key(),
    },
    now: when,
  });
}

const link = () =>
  setEmployment(prisma, {
    userId: riderUserId,
    employment: 'outsourced',
    staffingSupplierId: officeId,
    actorUserId: admin,
  });

const rider = () => prisma.rider.findUniqueOrThrow({ where: { id: riderId } });

describe('sending a deposit', () => {
  it('needs the rider’s own Basata receipt photo, an amount within the cash and a new reference', async () => {
    await collect(100_000, at(-300));
    const before = at(-120);
    await expect(
      deposit(50_000, before, { photoId: (await receipt(admin)).id }),
    ).rejects.toMatchObject({
      code: 'receipt_required',
    });
    await expect(
      deposit(50_000, before, { photoId: (await receipt(riderUserId, 'receipt')).id }),
    ).rejects.toMatchObject({ code: 'receipt_required' });
    await expect(deposit(100_001, before)).rejects.toMatchObject({ code: 'more_than_cash' });

    const first = await deposit(60_000, before, { reference: 'bs 7781' });
    expect(first.number).toBe('BD-000001');
    expect(first.status).toBe('pending');
    expect(first.reference).toBe('BS7781');
    expect(first.deadlineDay).toBe(DAY);
    // The same reference, however it is typed, is refused.
    await expect(deposit(10_000, before, { reference: 'BS 7781' })).rejects.toMatchObject({
      code: 'reference_used',
    });
    // A pending deposit counts as handed in: only 400 EGP is left to deposit.
    expect(await cashToHandIn(prisma, riderId)).toBe(40_000);
    await expect(deposit(40_001, before)).rejects.toMatchObject({ code: 'more_than_cash' });
    // Never in the future.
    await expect(
      submitBasataDeposit(prisma, {
        riderUserId,
        body: {
          amountPiastres: 1000,
          reference: 'FUT-1',
          depositedAt: at(10).toISOString(),
          photoId: (await receipt()).id,
          idempotencyKey: key(),
        },
        now: before,
      }),
    ).rejects.toMatchObject({ code: 'deposit_in_future' });
    // The same key answers the same deposit.
    const k = key();
    const a = await deposit(1000, before, { idempotencyKey: k });
    const b = await deposit(1000, before, { idempotencyKey: k });
    expect(b.id).toBe(a.id);
    const audit = await prisma.auditLog.count({ where: { action: 'basata_deposit.submit' } });
    expect(audit).toBe(2);
  });

  it('is refused while Basata is closed for the rider’s store', async () => {
    await collect(10_000, at(-300));
    await set('cash.basata_enabled', 0, f.store.id);
    await expect(deposit(5000, at(-60))).rejects.toMatchObject({ code: 'basata_closed' });
    expect((await riderBasata(prisma, riderId, at(-60))).enabled).toBe(false);
    await set('cash.basata_enabled', 1, f.store.id);
    await expect(deposit(5000, at(-60))).resolves.toMatchObject({ status: 'pending' });
  });
});

describe('Accounting reviews a deposit', () => {
  it('approves: Dr Money at Basata, Cr rider cash, the receipt kept with the entry', async () => {
    await collect(80_000, at(-300));
    const d = await deposit(80_000, at(-60));
    await expect(
      approveBasataDeposit(prisma, { depositId: d.id, actorUserId: riderUserId, now: at(-30) }),
    ).rejects.toMatchObject({ code: 'own_deposit' });
    const ok = await approveBasataDeposit(prisma, {
      depositId: d.id,
      actorUserId: finance,
      now: at(-30),
    });
    expect(ok.status).toBe('approved');
    expect(ok.heldPiastres).toBe(80_000);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: `basata_deposit:${d.id}` },
      include: { lines: { include: { account: true } }, receipts: true },
    });
    expect(entry.kind).toBe('basata_deposit');
    const transit = entry.lines.find((l) => l.account.key === 'basata_transit')!;
    expect(transit.amountPiastres).toBe(80_000);
    expect(transit.account.groupCode).toBe(1200);
    expect(transit.account.nameEn).toBe('Money at Basata, on its way to the bank');
    expect(entry.lines.find((l) => l.account.key === `rider_cash:${riderId}`)!.amountPiastres).toBe(
      -80_000,
    );
    for (const l of entry.lines) expect(l).toMatchObject({ riderId, darkStoreId: f.store.id });
    expect(entry.receipts).toHaveLength(1);
    expect(await balanceOf(prisma, { type: 'rider_cash', riderId })).toBe(0);
    // Approving again answers the same deposit.
    await approveBasataDeposit(prisma, { depositId: d.id, actorUserId: finance, now: at(-20) });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'basata_deposit' } })).toBe(1);
    // The cash position shows it at Basata.
    const pos = await cashPosition(prisma, { stores: null, now: at(-10) });
    expect(pos.basata.atBasataPiastres).toBe(80_000);
    expect(pos.money.rows.find((r) => r.kind === 'basata')!.balancePiastres).toBe(80_000);
    await expectBalanced();
  });

  it('rejects with a reason and moves no money before the deadline', async () => {
    await collect(30_000, at(-300));
    const d = await deposit(30_000, at(-60));
    await expect(
      rejectBasataDeposit(prisma, {
        depositId: d.id,
        actorUserId: finance,
        reason: 'bad',
        now: at(-30),
      }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    const r = await rejectBasataDeposit(prisma, {
      depositId: d.id,
      actorUserId: finance,
      reason: 'Receipt is not readable',
      now: at(-30),
    });
    expect(r.status).toBe('rejected');
    expect(await prisma.ledgerEntry.count({ where: { kind: { startsWith: 'basata' } } })).toBe(0);
    expect((await rider()).frozenAt).toBeNull();
    // The cash is to hand in again.
    expect(await cashToHandIn(prisma, riderId)).toBe(30_000);
  });
});

describe('the deposit deadline', () => {
  it('charges a rider of an office to the office’s wallet and freezes them', async () => {
    await link();
    await collect(50_000, at(-300));
    const result = await runDepositDeadline(prisma, at(1));
    expect(result.days).toEqual([DAY]);
    const ded = await prisma.riderCashDeduction.findUniqueOrThrow({
      where: { key: `basata_deadline:${riderId}:${DAY}` },
    });
    expect(ded).toMatchObject({ amountPiastres: 50_000, supplierId: officeId, kind: 'deadline' });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: ded.entryId! },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.kind).toBe('basata_deadline_charge');
    expect(entry.occurredAt.getTime()).toBe(T.getTime());
    expect(entry.lines.find((l) => l.account.supplierId === officeId)!.amountPiastres).toBe(50_000);
    expect(await balanceOf(prisma, { type: 'rider_cash', riderId })).toBe(0);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(50_000);
    const r = await rider();
    expect(r.frozenAt).not.toBeNull();
    expect(r.frozenReason).toBe('deposit_deadline');
    const alert = await prisma.alert.findUniqueOrThrow({
      where: { key: `rider_frozen:basata_deadline:${riderId}:${DAY}` },
    });
    expect(alert).toMatchObject({ type: 'rider_frozen', darkStoreId: f.store.id });
    expect(await prisma.riderFreeze.count({ where: { riderId } })).toBe(1);
    expect((await listFrozenRiders(prisma, null))[0]).toMatchObject({
      riderId,
      deductedPiastres: 50_000,
      office: { id: officeId },
    });
    await expectBalanced();
  });

  it('charges a rider without an office to their dues (1350) and freezes them', async () => {
    await collect(20_000, at(-300));
    await runDepositDeadline(prisma, at(5));
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(20_000);
    expect(await balanceOf(prisma, { type: 'rider_cash', riderId })).toBe(0);
    expect((await rider()).frozenAt).not.toBeNull();
    await expectBalanced();
  });

  it('counts a deposit sent before the deadline as on time, even while still pending', async () => {
    await collect(40_000, at(-300));
    await deposit(40_000, at(-10));
    await runDepositDeadline(prisma, at(1));
    expect(await prisma.riderCashDeduction.count()).toBe(0);
    expect((await rider()).frozenAt).toBeNull();
  });

  it('works from the books as of the deadline when the job runs late', async () => {
    // 300 EGP held at 23:00; 200 more collected after it; the rider hands everything to the
    // store at 23:30; the server slept and the job runs the next morning.
    await collect(30_000, at(-300));
    await collect(20_000, at(10));
    await recordCashHandover(prisma, {
      riderId,
      darkStoreId: f.store.id,
      countedPiastres: 50_000,
      receivedById: admin,
      idempotencyKey: key(),
    });
    const late = at(10 * 60);
    const result = await runDepositDeadline(prisma, late);
    expect(result.days).toEqual([DAY]);
    const ded = await prisma.riderCashDeduction.findFirstOrThrow();
    // He held 300 EGP at the deadline (not 500): late, so frozen, but nothing is taken twice.
    expect(ded.heldPiastres).toBe(30_000);
    expect(ded.amountPiastres).toBe(0);
    expect(ded.entryId).toBeNull();
    expect((await rider()).frozenAt).not.toBeNull();
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(0);
    await expectBalanced();
  });

  it('runs once per day: a second run changes nothing', async () => {
    await collect(10_000, at(-300));
    await runDepositDeadline(prisma, at(1));
    const again = await runDepositDeadline(prisma, at(2));
    expect(again.days).toEqual([]);
    expect(await prisma.riderCashDeduction.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'basata_deadline_charge' } })).toBe(1);
    expect(await prisma.alert.count({ where: { type: 'rider_frozen' } })).toBe(1);
    // The next day's deadline is a new run.
    const next = await runDepositDeadline(prisma, depositDeadline(addDays(DAY, 1), 23));
    expect(next.days).toEqual([addDays(DAY, 1)]);
  });

  it('does nothing while the deadline is switched off (the day is marked skipped)', async () => {
    await set('cash.deposit_deadline_enabled', 0);
    await collect(10_000, at(-300));
    await runDepositDeadline(prisma, at(1));
    expect(await prisma.riderCashDeduction.count()).toBe(0);
    const run = await prisma.cashDeadlineRun.findUniqueOrThrow({
      where: { day: new Date(`${DAY}T00:00:00Z`) },
    });
    expect(run.skipped).toBe(true);
  });

  it('takes nothing on its very first run: it only marks where the rule starts', async () => {
    await prisma.cashDeadlineRun.deleteMany();
    await collect(10_000, at(-300));
    const first = await runDepositDeadline(prisma, at(1));
    expect(first.days).toEqual([]);
    expect(await prisma.riderCashDeduction.count()).toBe(0);
    expect((await rider()).frozenAt).toBeNull();
    // From the next deadline on, the rule applies.
    const next = await runDepositDeadline(prisma, depositDeadline(addDays(DAY, 1), 23));
    expect(next.days).toEqual([addDays(DAY, 1)]);
    expect((await rider()).frozenAt).not.toBeNull();
  });

  it('gives back to the rider’s dues what a late deposit covers, the rest to their wallet', async () => {
    await collect(30_000, at(-300));
    await runDepositDeadline(prisma, at(1));
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(30_000);
    // A withdrawal already took 100 EGP of those dues from the rider's earnings.
    await post(prisma, {
      kind: 'rider_withdrawal',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'rider_bonus', riderId }, amount: 10_000 },
        { account: { type: 'rider_dues', riderId }, amount: -10_000 },
      ],
    });
    const d = await deposit(30_000, at(60));
    await approveBasataDeposit(prisma, { depositId: d.id, actorUserId: finance, now: at(90) });
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(0);
    // What the withdrawal already took is owed back to the rider.
    expect(await balanceOf(prisma, { type: 'rider_bonus', riderId })).toBe(0);
    await expectBalanced();
  });

  it('a deposit refused after its deadline takes the cash at once and freezes the rider', async () => {
    await collect(25_000, at(-300));
    const d = await deposit(25_000, at(-30));
    await runDepositDeadline(prisma, at(1));
    expect((await rider()).frozenAt).toBeNull();
    await rejectBasataDeposit(prisma, {
      depositId: d.id,
      actorUserId: finance,
      reason: 'Reference not found at Basata',
      now: at(600),
    });
    const ded = await prisma.riderCashDeduction.findUniqueOrThrow({
      where: { key: `basata_rejected:${d.id}` },
    });
    expect(ded).toMatchObject({ kind: 'rejected', amountPiastres: 25_000, depositId: d.id });
    expect(await balanceOf(prisma, { type: 'rider_dues', riderId })).toBe(25_000);
    expect((await rider()).frozenReason).toBe('deposit_rejected');
    await expectBalanced();
  });

  it('a late deposit approved after the charge gives it back to the office; the rider stays frozen', async () => {
    await link();
    await collect(60_000, at(-300));
    await runDepositDeadline(prisma, at(1));
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(60_000);
    // Nothing is left in rider cash, but what was taken can still be deposited.
    expect((await riderBasata(prisma, riderId, at(60))).maxPiastres).toBe(60_000);
    const d = await deposit(60_000, at(60));
    const ok = await approveBasataDeposit(prisma, {
      depositId: d.id,
      actorUserId: finance,
      now: at(120),
    });
    expect(ok.heldPiastres).toBe(0);
    expect(ok.givenBackPiastres).toBe(60_000);
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: officeId })).toBe(0);
    expect(await balanceOf(prisma, { type: 'basata_transit' })).toBe(60_000);
    expect((await rider()).frozenAt).not.toBeNull();
    expect((await prisma.riderCashDeduction.findFirstOrThrow()).givenBackPiastres).toBe(60_000);
    // Never more than held plus taken.
    await collect(1000, at(130));
    const extra = await deposit(1000, at(130));
    await prisma.basataDeposit.update({ where: { id: extra.id }, data: { amountPiastres: 5000 } });
    await expect(
      approveBasataDeposit(prisma, { depositId: extra.id, actorUserId: finance, now: at(140) }),
    ).rejects.toMatchObject({ code: 'more_than_cash' });
    await expectBalanced();
  });
});

describe('a frozen rider', () => {
  async function packedOrder() {
    await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 5 });
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
    return ids;
  }

  it('takes no orders and asks for no withdrawal until Accounting unfreezes them', async () => {
    await collect(10_000, at(-300));
    await runDepositDeadline(prisma, at(1));
    const ids = await packedOrder();
    await expect(handToRider(prisma, { ...ids, badgeCode: 'RDR-1' })).rejects.toMatchObject({
      code: 'rider_frozen',
    });
    await expect(
      requestWithdrawal(prisma, {
        riderUserId,
        body: {
          amountPiastres: 10_000,
          details: { method: 'instapay', handle: 'rider1@instapay' },
          idempotencyKey: key(),
        },
      }),
    ).rejects.toMatchObject({ code: 'rider_frozen' });
    // He can still deposit at Basata.
    await expect(deposit(10_000, at(60))).resolves.toMatchObject({ status: 'pending' });

    await expect(
      unfreezeRider(prisma, { riderId, actorUserId: finance, reason: 'ok' }),
    ).rejects.toMatchObject({ code: 'reason_required' });
    await unfreezeRider(prisma, {
      riderId,
      actorUserId: finance,
      reason: 'Deposit checked with Basata',
    });
    expect((await rider()).frozenAt).toBeNull();
    const history = await prisma.riderFreeze.findFirstOrThrow({ where: { riderId } });
    expect(history.unfreezeReason).toBe('Deposit checked with Basata');
    expect(await prisma.auditLog.count({ where: { action: 'rider.unfreeze' } })).toBe(1);
    await expect(
      unfreezeRider(prisma, { riderId, actorUserId: finance, reason: 'again please' }),
    ).rejects.toMatchObject({ code: 'rider_not_frozen' });
    await expect(handToRider(prisma, { ...ids, badgeCode: 'RDR-1' })).resolves.toBeDefined();
  });
});

describe('Basata’s daily transfer', () => {
  it('books the bank, the fee and marks the deposits settled', async () => {
    await collect(100_000, at(-600));
    const a = await deposit(60_000, at(-300));
    const b = await deposit(40_000, at(-200));
    for (const d of [a, b])
      await approveBasataDeposit(prisma, { depositId: d.id, actorUserId: finance, now: at(-100) });
    const open = await unsettledBasataDeposits(prisma, { upToDay: DAY });
    expect(open.totalPiastres).toBe(100_000);
    const body = {
      receivedOn: addDays(DAY, 1),
      amountPiastres: 99_000,
      depositIds: [a.id, b.id],
      reference: 'CIB 5512',
      idempotencyKey: key(),
    };
    await expect(
      recordBasataSettlement(prisma, {
        body: { ...body, amountPiastres: 100_001 },
        actorUserId: finance,
      }),
    ).rejects.toMatchObject({ code: 'more_than_deposits' });
    const s = await recordBasataSettlement(prisma, { body, actorUserId: finance });
    expect(s).toMatchObject({
      number: 'BT-000001',
      amountPiastres: 99_000,
      depositsPiastres: 100_000,
      feePiastres: 1_000,
      deposits: 2,
    });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: s.entry.id },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.lines.find((l) => l.account.key === 'bank')!.amountPiastres).toBe(99_000);
    const fee = entry.lines.find((l) => l.account.key === 'basata_fees')!;
    expect(fee.amountPiastres).toBe(1_000);
    expect(fee.account.groupCode).toBe(5500);
    expect(entry.lines.find((l) => l.account.key === 'basata_transit')!.amountPiastres).toBe(
      -100_000,
    );
    expect(await balanceOf(prisma, { type: 'basata_transit' })).toBe(0);
    expect(await prisma.basataDeposit.count({ where: { settlementId: s.id } })).toBe(2);
    // The same key answers the same transfer; a settled deposit cannot be settled again.
    expect((await recordBasataSettlement(prisma, { body, actorUserId: finance })).id).toBe(s.id);
    await expect(
      recordBasataSettlement(prisma, {
        body: { ...body, idempotencyKey: key() },
        actorUserId: finance,
      }),
    ).rejects.toMatchObject({ code: 'deposit_already_settled' });
    await expectBalanced();
  });

  it('refuses deposits not approved yet', async () => {
    await collect(10_000, at(-600));
    const d = await deposit(10_000, at(-300));
    await expect(
      recordBasataSettlement(prisma, {
        body: {
          receivedOn: DAY,
          amountPiastres: 10_000,
          depositIds: [d.id],
          idempotencyKey: key(),
        },
        actorUserId: finance,
      }),
    ).rejects.toMatchObject({ code: 'deposit_not_approved' });
  });
});

describe('cash controls', () => {
  it('refuses a store handover while the store channel is closed', async () => {
    await collect(10_000, at(-300));
    await set('cash.store_handover_enabled', 0, f.store.id);
    await expect(
      recordCashHandover(prisma, {
        riderId,
        darkStoreId: f.store.id,
        countedPiastres: 10_000,
        receivedById: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'store_handover_closed' });
  });

  it('counts deposits waiting for review as handed in for the cash limit and overdue alerts', async () => {
    await set('finance.rider_cash_limit_piastres', 50_000);
    await collect(45_000, new Date(Date.now() - 20 * 3600_000));
    await prisma.$transaction(async (tx) => {
      await expect(
        checkRiderCashLimit(tx, {
          riderId,
          darkStoreId: f.store.id,
          orderId: 'o1',
          orderCodPiastres: 10_000,
          actorUserId: admin,
        }),
      ).rejects.toMatchObject({ code: 'rider_cash_limit' });
    });
    await deposit(45_000, new Date());
    await prisma.$transaction(async (tx) => {
      await expect(
        checkRiderCashLimit(tx, {
          riderId,
          darkStoreId: f.store.id,
          orderId: 'o1',
          orderCodPiastres: 10_000,
          actorUserId: admin,
        }),
      ).resolves.toMatchObject({ checked: true, overridden: false });
    });
    // Twenty hours old, but covered by the deposit: no overdue alert.
    expect((await checkRiderCashOverdue(prisma)).raised).toBe(0);
  });
});

describe('notifications', () => {
  it('tells Accounting about a new deposit and the rider about the decision and a freeze', async () => {
    const sent: { endpoint: string; message: PushMessage }[] = [];
    const sender: PushSender = {
      enabled: true,
      async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
        sent.push({ endpoint: target.endpoint, message });
        return 'sent';
      },
    };
    await prisma.$transaction((tx) =>
      writeAccess(tx, finance, { ...JOB_ROLE_TEMPLATES.finance_manager, jobRole: 'custom' }, []),
    );
    for (const [userId, name] of [
      [finance, 'finance'],
      [riderUserId, 'rider'],
    ] as const)
      await prisma.pushSubscription.create({
        data: { userId, endpoint: `https://push.test/${name}`, p256dh: 'k', auth: 'a', lang: 'en' },
      });
    // Payment reminders (payment_due) depend on today's date and are tested elsewhere.
    const to = () =>
      sent
        .filter((s) => !s.message.title.startsWith('Due on'))
        .map((s) => `${s.endpoint.replace('https://push.test/', '')}:${s.message.title}`);

    await collect(20_000, new Date(Date.now() - 3600_000));
    const d = await deposit(20_000, new Date());
    await dispatchPush(prisma, sender);
    expect(to()).toEqual(['finance:Basata deposit BD-000001 to check']);

    await approveBasataDeposit(prisma, { depositId: d.id, actorUserId: finance });
    await dispatchPush(prisma, sender);
    expect(to()).toContain('rider:Deposit BD-000001 approved');

    // A freeze (raised as an alert) reaches the rider and Accounting.
    const yesterday = addDays(cairoDay(new Date()), -1);
    const deadline = depositDeadline(yesterday, 23);
    await collect(5_000, new Date(deadline.getTime() - 3600_000));
    await prisma.cashDeadlineRun.deleteMany();
    await startDeadlines(addDays(yesterday, -1));
    await runDepositDeadline(prisma, new Date(deadline.getTime() + 60_000));
    sent.length = 0;
    await dispatchPush(prisma, sender);
    expect(to().sort()).toEqual(['finance:Rider frozen: Rider', 'rider:Your account is frozen']);
  });
});
