import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  CONTRACT_PRICE_KEYS,
  CONTRACT_PRICES,
  type ContractPriceKey,
  contractVersionSchema,
  type ContractVersionInput,
  makeTier,
  tierFor,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting, createUser } from '../src/admin-ops';
import {
  accrueStorage,
  activateContractVersion,
  addContractFile,
  applyContractSchedules,
  contractForPrint,
  contractPricesAt,
  createContractDraft,
  createPayout,
  deleteContractDraft,
  ensureDefaultAccounts,
  getContract,
  merchantContractView,
  minimumForMonth,
  pricesForDay,
  recordMerchantAdjustment,
  updateContractDraft,
  versionInForce,
} from '../src/finance';
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
let n = 0;
const key = () => `v2-${++n}-${Math.random()}`;
const today = () => cairoDay(new Date());
const set = (k: Parameters<typeof changeSetting>[1]['key'], value: number) =>
  changeSetting(prisma, { key: k, scope: 'global', value, actorUserId: admin });

const EMPTY = {
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
  minimumMonthlyFeePiastres: null,
  securityDepositPiastres: null,
  creditLimitPiastres: null,
  noticeDays: 30,
  endDate: null,
  tiers: [],
};
const body = (over: Partial<ContractVersionInput> = {}) =>
  contractVersionSchema.parse({ ...EMPTY, startDate: addDays(today(), -90), ...over });

/** A version made and activated (in the past only through allowPast, as a test). */
async function version(
  over: Partial<ContractVersionInput> = {},
  effectiveFrom = addDays(today(), -90),
  merchantId = f.merchant.id,
) {
  const draft = await createContractDraft(prisma, {
    merchantId,
    body: body(over),
    actorUserId: admin,
  });
  return activateContractVersion(prisma, {
    merchantId,
    versionId: draft.id,
    effectiveFrom,
    actorUserId: admin,
    allowPast: effectiveFrom < today(),
  });
}

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
  await receive(prisma, { skuId: f.sku.id, binId: f.shelfA.id, quantity: 30 });
  for (const [k, v] of [
    ['fee.order_fixed_piastres', 2_000],
    ['fee.order_percent_bp', 100],
    ['fee.cod_percent_bp', 100],
    ['fee.failed_delivery_piastres', 1_500],
    ['fee.receiving_per_unit_piastres', 50],
    ['fee.storage_per_unit_month_piastres', 300],
    ['fee.return_per_unit_piastres', 200],
  ] as const)
    await set(k, v);
});

afterAll(() => prisma.$disconnect());

/** One cash order of SKU-1 up to the rider; delivered unless `fail` is given. */
async function order(qty = 1, fail?: 'other') {
  const created = await createOrder(prisma, {
    merchantId: f.merchant.id,
    darkStoreId: f.store.id,
    source: 'manual',
    customerName: 'Customer',
    customerPhone: '01012345678',
    addressText: 'Somewhere in Cairo',
    paymentMethod: 'cod',
    deliveryFeePiastres: 0,
    items: [{ skuId: f.sku.id, quantity: qty }],
    actorUserId: admin,
  });
  const ids = { orderId: created.id, darkStoreId: f.store.id, actorUserId: admin };
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
  const full = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: created.id } });
  if (fail)
    return failDelivery(prisma, {
      deliveryId: delivery.id,
      riderUserId,
      reason: fail,
      note: 'Customer away',
    });
  await completeDelivery(prisma, {
    deliveryId: delivery.id,
    riderUserId,
    otp: full.deliveryOtp,
    codCollectedPiastres: full.codAmountPiastres,
  });
  return full;
}

/** Fee income (before VAT) of each entry of a kind, oldest first. */
const fees = async (kind: string) =>
  (
    await prisma.ledgerEntry.findMany({
      where: { kind },
      orderBy: { number: 'asc' },
      include: { lines: { include: { account: true } } },
    })
  ).map((e) => -e.lines.find((l) => l.account.type === 'revenue')!.amountPiastres);

describe('prices from the contract', () => {
  it('falls back field by field to the standard price', async () => {
    await version({ codPercentBp: 50, receivingPerUnitPiastres: 0 });
    const { prices } = await contractPricesAt(prisma, {
      merchantId: f.merchant.id,
      at: new Date(),
    });
    expect(prices).toEqual({
      orderFixedPiastres: 2_000,
      orderPercentBp: 100,
      codPercentBp: 50,
      failedDeliveryPiastres: 1_500,
      receivingPerUnitPiastres: 0,
      storagePerUnitMonthPiastres: 300,
      returnPerUnitPiastres: 200,
    });
    // A merchant with no contract pays the standard prices.
    const other = await prisma.merchant.create({ data: { name: 'No contract' } });
    expect(
      (await contractPricesAt(prisma, { merchantId: other.id, at: new Date() })).prices
        .codPercentBp,
    ).toBe(100);
    // Delivered orders are charged from it: 10 EGP products, 10 EGP cash.
    await order();
    expect(await fees('order_fee')).toEqual([2_010]);
    expect(await fees('cod_fee')).toEqual([5]);
  });

  it('applies tiers on every fee kind, at the band of the month so far', async () => {
    await version({
      tiers: [
        makeTier(2, {
          fixedFeePiastres: 1_000,
          codPercentBp: 0,
          failedDeliveryPiastres: 500,
          receivingPerUnitPiastres: 10,
          storagePerUnitMonthPiastres: 30,
          returnPerUnitPiastres: 20,
        }),
      ],
    });
    const at = new Date();
    const before = await contractPricesAt(prisma, { merchantId: f.merchant.id, at });
    // No delivery yet: the next delivered order is the 1st, before the band.
    expect(before.prices.failedDeliveryPiastres).toBe(1_500);
    await order();
    await order();
    expect(await fees('order_fee')).toEqual([2_010, 1_010]);
    // A zero fee books nothing.
    expect(await fees('cod_fee')).toEqual([10]);
    // Every other charge now uses the band of the next (3rd) delivered order.
    const after = await contractPricesAt(prisma, { merchantId: f.merchant.id, at: new Date() });
    expect(after).toMatchObject({ tierFrom: 2, nth: 3 });
    expect(after.prices).toMatchObject({
      failedDeliveryPiastres: 500,
      receivingPerUnitPiastres: 10,
      storagePerUnitMonthPiastres: 30,
      returnPerUnitPiastres: 20,
    });
    await order(1, 'other');
    expect(await fees('failed_fee')).toEqual([500]);
    // Storage for today: 28 units at 0.30 EGP a month, by the days of the month.
    const [y, m] = today().split('-').map(Number) as [number, number];
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    await accrueStorage(prisma, today());
    const units = (await prisma.binStock.findMany()).reduce((s, b) => s + b.quantity, 0);
    expect(await fees('storage_fee')).toEqual([
      Math.floor((units * 30 + Math.floor(days / 2)) / days),
    ]);
  });

  it('uses the version in force on the day of the event', async () => {
    await version({ orderFixedPiastres: 1_111 }, addDays(today(), -90));
    await version({ orderFixedPiastres: 2_222 }, addDays(today(), -10));
    await version({ orderFixedPiastres: 3_333 }, addDays(today(), 5));
    const at = (d: number) => cairoDayStart(addDays(today(), d));
    const price = async (d: number) =>
      (await contractPricesAt(prisma, { merchantId: f.merchant.id, at: at(d) })).prices
        .orderFixedPiastres;
    expect(await price(-100)).toBe(2_000);
    expect(await price(-50)).toBe(1_111);
    expect(await price(-10)).toBe(2_222);
    expect(await price(0)).toBe(2_222);
    expect(await price(5)).toBe(3_333);
    const view = await getContract(prisma, f.merchant.id);
    expect(view.contract?.label).toBe('CTR-000001');
    expect(view.current?.version).toBe(2);
    expect(view.scheduled.map((v) => v.version)).toEqual([3]);
    expect(view.versions.map((v) => [v.version, v.displayStatus])).toEqual([
      [3, 'scheduled'],
      [2, 'in_force'],
      [1, 'superseded'],
    ]);
  });
});

describe('versions', () => {
  it('activates only from today on, after the last version, outside closed books', async () => {
    const first = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body(),
      actorUserId: admin,
    });
    // One draft at a time.
    await expect(
      createContractDraft(prisma, { merchantId: f.merchant.id, body: body(), actorUserId: admin }),
    ).rejects.toThrow('contract_draft_exists');
    await expect(
      activateContractVersion(prisma, {
        merchantId: f.merchant.id,
        versionId: first.id,
        effectiveFrom: addDays(today(), -1),
        actorUserId: admin,
      }),
    ).rejects.toThrow('effective_before_today');
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: first.id,
      effectiveFrom: addDays(today(), 10),
      actorUserId: admin,
    });
    await expect(
      activateContractVersion(prisma, {
        merchantId: f.merchant.id,
        versionId: first.id,
        effectiveFrom: addDays(today(), 10),
        actorUserId: admin,
      }),
    ).rejects.toThrow('contract_version_not_draft');
    // An activated version never changes, not even in the database.
    await expect(
      prisma.merchantContractVersion.update({
        where: { id: first.id },
        data: { orderFixedPiastres: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      updateContractDraft(prisma, {
        merchantId: f.merchant.id,
        versionId: first.id,
        body: body(),
        actorUserId: admin,
      }),
    ).rejects.toThrow('contract_version_not_draft');

    const second = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body({ orderFixedPiastres: 900 }),
      actorUserId: admin,
    });
    await expect(
      activateContractVersion(prisma, {
        merchantId: f.merchant.id,
        versionId: second.id,
        effectiveFrom: addDays(today(), 5),
        actorUserId: admin,
      }),
    ).rejects.toThrow('effective_before_last_version');
    // Closed books: nothing takes effect inside them.
    await prisma.booksLock.create({
      data: {
        closedThrough: new Date(`${addDays(today(), 20)}T00:00:00Z`),
        lockedBefore: cairoDayStart(addDays(today(), 21)),
        updatedById: admin,
      },
    });
    await expect(
      activateContractVersion(prisma, {
        merchantId: f.merchant.id,
        versionId: second.id,
        effectiveFrom: addDays(today(), 15),
        actorUserId: admin,
      }),
    ).rejects.toThrow('books_closed');
    await prisma.booksLock.deleteMany();
    await activateContractVersion(prisma, {
      merchantId: f.merchant.id,
      versionId: second.id,
      effectiveFrom: addDays(today(), 15),
      actorUserId: admin,
    });
    const rows = await prisma.merchantContractVersion.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'active']);
    // Activation is audited with the terms before and after.
    const audit = await prisma.auditLog.findMany({
      where: { action: 'merchant.contract_activate' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]!.after).toMatchObject({ version: 'CTR-000001 v2', orderFixedPiastres: 900 });
  });

  it('changes and throws away drafts, and keeps signed files', async () => {
    const draft = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body(),
      actorUserId: admin,
      idempotencyKey: 'draft-key-1',
    });
    // The same key gives the same draft back.
    const again = await createContractDraft(prisma, {
      merchantId: f.merchant.id,
      body: body(),
      actorUserId: admin,
      idempotencyKey: 'draft-key-1',
    });
    expect(again.id).toBe(draft.id);
    await updateContractDraft(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      body: body({ tiers: [{ fromOrder: 10, returnPerUnitPiastres: 0 }], terms: 'Free returns' }),
      actorUserId: admin,
    });
    const view = await getContract(prisma, f.merchant.id);
    expect(view.draft?.tiers).toEqual([makeTier(10, { returnPerUnitPiastres: 0 })]);
    expect(view.current).toBeNull();
    const pdf = Buffer.from('%PDF-1.4 signed');
    await addContractFile(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      fileName: 'signed.pdf',
      contentType: 'application/pdf',
      data: pdf,
      actorUserId: admin,
    });
    await expect(
      addContractFile(prisma, {
        merchantId: f.merchant.id,
        fileName: 'fake.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('not a pdf'),
        actorUserId: admin,
      }),
    ).rejects.toThrow('file_type_not_allowed');
    await expect(
      addContractFile(prisma, {
        merchantId: f.merchant.id,
        fileName: 'big.pdf',
        contentType: 'application/pdf',
        data: Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)]),
        actorUserId: admin,
      }),
    ).rejects.toThrow('file_too_large');
    await deleteContractDraft(prisma, {
      merchantId: f.merchant.id,
      versionId: draft.id,
      actorUserId: admin,
    });
    const after = await getContract(prisma, f.merchant.id);
    expect(after.draft).toBeNull();
    expect(after.files).toHaveLength(1);
    expect(after.files[0]!.versionId).toBeNull();
    // The merchant never sees drafts, files or internal notes.
    expect(merchantContractView(after).files).toEqual([]);
  });

  it('sets the agreed payout schedule when it takes effect and flags a later change', async () => {
    await version({ payoutSchedule: 'daily' }, today());
    expect(
      (await prisma.merchant.findUniqueOrThrow({ where: { id: f.merchant.id } })).payoutSchedule,
    ).toBe('daily');
    await version({ payoutSchedule: 'twice_weekly' }, addDays(today(), 3));
    expect((await applyContractSchedules(prisma, new Date())).applied).toBe(0);
    const later = cairoDayStart(addDays(today(), 3));
    expect((await applyContractSchedules(prisma, later)).applied).toBe(1);
    expect((await applyContractSchedules(prisma, later)).applied).toBe(0);
    expect(
      (await prisma.merchant.findUniqueOrThrow({ where: { id: f.merchant.id } })).payoutSchedule,
    ).toBe('twice_weekly');
    // The merchant changes it themselves: the contract keeps the agreed one and flags it.
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { payoutSchedule: 'weekly' },
    });
    expect((await getContract(prisma, f.merchant.id, later)).scheduleDiffers).toBe(true);
  });
});

describe('payment terms and promises', () => {
  it('waits for the payout minimum, the contract before the setting', async () => {
    const owe = (amount: number) =>
      recordMerchantAdjustment(prisma, {
        merchantId: f.merchant.id,
        amountPiastres: amount,
        reason: 'Fees owed',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await owe(30_000);
    const pay = () =>
      createPayout(prisma, {
        merchantId: f.merchant.id,
        cutoffAt: cairoDayStart(addDays(today(), 1)),
        actorUserId: admin,
      });
    await set('finance.payout_minimum_piastres', 50_000);
    await expect(pay()).rejects.toThrow('below_payout_minimum');
    await version({ minimumPayoutPiastres: 20_000 });
    const payout = await pay();
    expect(payout.amountPiastres).toBe(30_000);
  });

  it("gives the merchant's orders the contract's delivery attempts", async () => {
    // The store allows 2 attempts; the contract includes only 1, so one failure is final.
    await version({ deliveryAttempts: 1 });
    const result = await order(1, 'other');
    expect(result).toMatchObject({ status: 'failed', maxAttempts: 1 });
  });

  it('prints the version in force with the company and the merchant', async () => {
    await version({ terms: 'Free packaging', internalNote: 'Owner is a friend' });
    const print = await contractForPrint(prisma, { merchantId: f.merchant.id });
    expect(print.contract.label).toBe('CTR-000001');
    expect(print.version.terms).toBe('Free packaging');
    expect(print.version.internalNote).toBe('Owner is a friend');
    const copy = await contractForPrint(prisma, { merchantId: f.merchant.id, merchantCopy: true });
    expect(copy.version.internalNote).toBeNull();
  });
});

// ─── migration ───────────────────────────────────────────────────────────────────

/** The migration's data part, run again on rows shaped like before it. */
function migrationData() {
  const sql = readFileSync(
    path.resolve(__dirname, '../prisma/migrations/20261231090000_contract_versions/migration.sql'),
    'utf8',
  );
  const part = sql.split('-- contract v2 data: begin')[1]!.split('-- contract v2 data: end')[0]!;
  return part
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

const SETTING_OF = Object.fromEntries(
  CONTRACT_PRICE_KEYS.map((k) => [k, CONTRACT_PRICES[k].setting]),
) as Record<ContractPriceKey, string>;

describe('migration from settings and the earlier contract', () => {
  it('prices every charge exactly as before, on every day and place in the month', async () => {
    const created = cairoDayStart(addDays(today(), -120));
    await prisma.merchant.update({ where: { id: f.merchant.id }, data: { createdAt: created } });
    const plain = await prisma.merchant.create({
      data: { name: 'Settings only', createdAt: created },
    });
    const none = await prisma.merchant.create({ data: { name: 'Nothing', createdAt: created } });
    // The earlier shapes: the merchant's own fee settings and the earlier contract table.
    const own: Record<string, Partial<Record<ContractPriceKey, number>>> = {
      [f.merchant.id]: {
        orderFixedPiastres: 1_800,
        codPercentBp: 150,
        failedDeliveryPiastres: 2_500,
        receivingPerUnitPiastres: 70,
        storagePerUnitMonthPiastres: 400,
        returnPerUnitPiastres: 0,
      },
      [plain.id]: { orderPercentBp: 250 },
    };
    for (const [merchantId, values] of Object.entries(own))
      for (const [k, v] of Object.entries(values))
        await prisma.setting.create({
          data: {
            key: SETTING_OF[k as ContractPriceKey],
            scope: `merchant:${merchantId}`,
            value: v,
          },
        });
    const legacy = {
      start: addDays(today(), -40),
      end: addDays(today(), 10),
      minimum: 100_000,
      tiers: [
        { fromOrder: 1, fixedFeePiastres: 1_500, percentBp: null },
        { fromOrder: 3, fixedFeePiastres: 1_000, percentBp: 0 },
      ],
    };
    await prisma.$executeRawUnsafe(`CREATE TABLE legacy_merchant_contracts (
      id text, merchant_id text, start_date date, end_date date, notice_days int,
      minimum_monthly_fee_piastres int, security_deposit_piastres int,
      credit_limit_piastres int, note text)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE legacy_merchant_contract_tiers (
      id text, contract_id text, from_order int, fixed_fee_piastres int, percent_bp int)`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO legacy_merchant_contracts VALUES ('old-1', $1, $2::date, $3::date, 45, $4, 500000, 2000000, 'Signed in May')`,
      f.merchant.id,
      legacy.start,
      legacy.end,
      legacy.minimum,
    );
    for (const t of legacy.tiers)
      await prisma.$executeRawUnsafe(
        `INSERT INTO legacy_merchant_contract_tiers VALUES ($1, 'old-1', $2, $3, $4)`,
        `t-${t.fromOrder}`,
        t.fromOrder,
        t.fixedFeePiastres,
        t.percentBp,
      );
    const standard = {} as Record<ContractPriceKey, number>;
    for (const k of CONTRACT_PRICE_KEYS)
      standard[k] = (
        await prisma.setting.findUniqueOrThrow({
          where: { key_scope: { key: SETTING_OF[k], scope: 'global' } },
        })
      ).value as number;

    /** The earlier rule: the merchant's setting, else the global one; order fee tiers in dates. */
    const before = (merchantId: string, k: ContractPriceKey, day: string, nth: number) => {
      const setting = own[merchantId]?.[k] ?? standard[k];
      const inForce = merchantId === f.merchant.id && legacy.start <= day && legacy.end >= day;
      if (!inForce || (k !== 'orderFixedPiastres' && k !== 'orderPercentBp')) return setting;
      const tier = tierFor(legacy.tiers, nth);
      const value = k === 'orderFixedPiastres' ? tier?.fixedFeePiastres : tier?.percentBp;
      return value ?? setting;
    };
    const days = [-119, -60, -41, -40, -20, 0, 10, 11, 30].map((d) => addDays(today(), d));
    const places = [1, 2, 3, 4, 50];
    const expected: number[] = [];
    for (const m of [f.merchant.id, plain.id, none.id])
      for (const day of days)
        for (const nth of places)
          for (const k of CONTRACT_PRICE_KEYS) expected.push(before(m, k, day, nth));
    const oldMinimum = (month: string) => {
      const first = `${month}-01`;
      const [y, mo] = month.split('-').map(Number) as [number, number];
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const last = `${month}-${String(dim).padStart(2, '0')}`;
      const start = legacy.start > first ? legacy.start : first;
      const end = legacy.end < last ? legacy.end : last;
      if (start > end) return 0;
      const inDays = Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1;
      return Math.round((legacy.minimum * inDays) / dim);
    };
    const months = [addDays(today(), -40).slice(0, 7), today().slice(0, 7)];

    for (const statement of migrationData()) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe('DROP TABLE legacy_merchant_contract_tiers');
    await prisma.$executeRawUnsafe('DROP TABLE legacy_merchant_contracts');

    const after: number[] = [];
    for (const m of [f.merchant.id, plain.id, none.id])
      for (const day of days)
        for (const nth of places) {
          const { prices } = await pricesForDay(prisma, { merchantId: m, day, nth });
          for (const k of CONTRACT_PRICE_KEYS) after.push(prices[k]);
        }
    expect(after).toEqual(expected);
    for (const month of months)
      expect((await minimumForMonth(prisma, f.merchant.id, month)).minimum).toBe(oldMinimum(month));

    // Every merchant got version 1; the merchant's own fee settings are gone.
    const contracts = await prisma.merchantContract.findMany({ orderBy: { number: 'asc' } });
    expect(contracts.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(await prisma.setting.count({ where: { scope: { startsWith: 'merchant:' } } })).toBe(0);
    const v1 = await versionInForce(prisma, f.merchant.id, today());
    expect(v1).toMatchObject({
      version: 1,
      status: 'active',
      source: 'migration',
      noticeDays: 45,
      minimumMonthlyFeePiastres: 100_000,
      securityDepositPiastres: 500_000,
      creditLimitPiastres: 2_000_000,
      internalNote: 'Signed in May',
      orderFixedPiastres: 1_800,
      orderPercentBp: null,
    });
    expect(v1!.tiers).toHaveLength(2);
    // A delivered order after the migration is charged as before (the 1st order of the month
    // in the earlier contract's band: 15 EGP fixed, 1% of 10 EGP).
    await order();
    expect(await fees('order_fee')).toEqual([
      before(f.merchant.id, 'orderFixedPiastres', today(), 1) + 10,
    ]);
    expect(await fees('cod_fee')).toEqual([15]);
    // Running it again adds nothing.
    await prisma.$executeRawUnsafe(`CREATE TABLE legacy_merchant_contracts (
      id text, merchant_id text, start_date date, end_date date, notice_days int,
      minimum_monthly_fee_piastres int, security_deposit_piastres int,
      credit_limit_piastres int, note text)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE legacy_merchant_contract_tiers (
      id text, contract_id text, from_order int, fixed_fee_piastres int, percent_bp int)`);
    for (const statement of migrationData()) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe('DROP TABLE legacy_merchant_contract_tiers');
    await prisma.$executeRawUnsafe('DROP TABLE legacy_merchant_contracts');
    expect(await prisma.merchantContractVersion.count()).toBe(3);
  });
});
