import { cairoDayStart, forecastMonths } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  compareForecasts,
  createForecast,
  deleteForecast,
  ensureDefaultAccounts,
  forecastBudgetPreview,
  forecastDetail,
  forecastSuggestion,
  forecastToBudget,
  listForecasts,
  post,
  saveForecastDrivers,
  saveForecastOverrides,
  setForecastStatus,
} from '../src/finance';
import { setBudget } from '../src/finance/period';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// The books before "now" (15 November 2026): August, September and October with 10, 12 and
// 15 delivered orders, an order fee of 20 EGP each, rider pay of 15 EGP each, rent of 3,000
// EGP a month and marketing of 900 EGP in August only; equipment bought in October.
const NOW = new Date('2026-11-15T10:00:00Z');
const BASED = ['2026-08', '2026-09', '2026-10'];
const ORDERS = [10, 12, 15];

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `fc-${++n}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const mid = (month: string) => new Date(cairoDayStart(`${month}-15`).getTime() + 12 * 3600_000);

async function seedBooks() {
  const bank = { type: 'bank' as const };
  await post(prisma, {
    kind: 'capital',
    idempotencyKey: key(),
    occurredAt: new Date('2026-07-10T10:00:00Z'),
    lines: [
      { account: bank, amount: 10_000_000 },
      { account: { id: (await byKey('equity:capital')).id }, amount: -10_000_000 },
    ],
  });
  const rent = await byKey('expense:rent');
  const marketing = await byKey('expense:marketing');
  for (const [i, month] of BASED.entries()) {
    const orders = ORDERS[i]!;
    for (let k = 0; k < orders; k++)
      await prisma.order.create({
        data: {
          number: `SN-${month}-${k}`,
          merchantId: f.merchant.id,
          darkStoreId: f.store.id,
          status: 'delivered',
          customerName: 'Mona',
          customerPhone: '+201001234567',
          addressText: 'Maadi',
          deliveryOtp: '1234',
          trackingToken: `tok-${month}-${k}`,
          paymentMethod: k % 2 ? 'prepaid' : 'cod',
          subtotalPiastres: 10_000,
          codAmountPiastres: k % 2 ? 0 : 50_000,
          placedAt: mid(month),
          deliveredAt: mid(month),
        },
      });
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: mid(month),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: orders * 2_000 },
        { account: { type: 'revenue' }, amount: -orders * 2_000 },
      ],
    });
    await post(prisma, {
      kind: 'rider_bonus',
      idempotencyKey: key(),
      occurredAt: mid(month),
      lines: [
        { account: { type: 'rider_bonus_expense' }, amount: orders * 1_500 },
        { account: bank, amount: -orders * 1_500 },
      ],
    });
    await post(prisma, {
      kind: 'expense',
      idempotencyKey: key(),
      occurredAt: mid(month),
      lines: [
        { account: { id: rent.id }, amount: 300_000 },
        { account: bank, amount: -300_000 },
      ],
    });
  }
  await post(prisma, {
    kind: 'expense',
    idempotencyKey: key(),
    occurredAt: mid('2026-08'),
    lines: [
      { account: { id: marketing.id }, amount: 90_000 },
      { account: bank, amount: -90_000 },
    ],
  });
  const bought = await post(prisma, {
    kind: 'asset_purchase',
    idempotencyKey: key(),
    occurredAt: mid('2026-10'),
    lines: [
      { account: { type: 'fixed_assets' }, amount: 1_200_000 },
      { account: bank, amount: -1_200_000 },
    ],
  });
  await prisma.fixedAsset.create({
    data: {
      name: 'Scooter',
      costPiastres: 1_200_000,
      lifeMonths: 12,
      startMonth: '2026-10',
      entryId: bought!.id,
      createdById: admin,
    },
  });
  return { rent, marketing };
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await setSetting(prisma, { key: 'fee.vat_bp', value: 1_400, actorUserId: null });
});

afterAll(() => prisma.$disconnect());

describe('forecast suggestion', () => {
  it('starts at zero when the books hold nothing', async () => {
    const s = await forecastSuggestion(prisma, NOW);
    expect(s.startMonth).toBe('2026-11');
    expect(s.basedOn).toEqual([]);
    expect(s.opening.cash).toBe(0);
    expect(s.drivers).toEqual([{ month: '2026-11', key: 'vat_bp', value: 1_400 }]);
  });

  it('reads the last three complete months of the books', async () => {
    const { marketing } = await seedBooks();
    const s = await forecastSuggestion(prisma, NOW);
    const d = (k: string, month = '2026-11') =>
      s.drivers.find((x) => x.key === k && x.month === month)?.value;
    expect(s.basedOn).toEqual(BASED);
    // Growth +20% then +25%: 22.5% a month; 15 × 1.225 = 18.4 → 18
    expect(d('growth_bp')).toBe(2_250);
    expect(d('orders')).toBe(18);
    expect(d('fee:order_fee')).toBe(2_000);
    expect(d('rider_pay_per_order')).toBe(1_500);
    expect(d('rent')).toBe(300_000);
    expect(d(`fixed:${marketing.id}`)).toBe(30_000);
    // 5 + 6 + 8 cash orders of 37: 51.35% at 500 EGP each
    expect(d('cod_share_bp')).toBe(5_135);
    expect(d('cod_per_order')).toBe(50_000);
    expect(d('orders_per_new_merchant')).toBe(15);
    // Equipment of 12,000 EGP over 12 months from October: November is its second month.
    expect(d('depreciation')).toBe(100_000);
    expect(d('depreciation', '2027-09')).toBe(100_000);
    expect(d('depreciation', '2027-10')).toBeUndefined();
    // Opening balances balance: assets = liabilities + equity.
    const o = s.opening;
    expect(o.cash + o.riderCash + o.fixedAssets + o.otherAssets).toBe(
      o.merchants + o.vatPayable + o.loans + o.otherLiabilities + o.capital + o.retainedEarnings,
    );
    expect(o.fixedAssets).toBe(1_200_000);
    expect(o.capital).toBe(10_000_000);
  });

  it('takes recurring expenses for the months they cover', async () => {
    const { rent } = await seedBooks();
    await prisma.recurringEntry.create({
      data: {
        name: 'New rent',
        payload: { expenseAccountId: rent.id, vatPiastres: 0 },
        amountPiastres: 450_000,
        dayOfMonth: 1,
        startMonth: '2027-01',
        endMonth: '2027-03',
        createdById: admin,
      },
    });
    const s = await forecastSuggestion(prisma, NOW);
    const rentRows = s.drivers.filter((x) => x.key === 'rent');
    expect(rentRows).toEqual([
      { month: '2026-11', key: 'rent', value: 300_000 },
      { month: '2027-01', key: 'rent', value: 450_000 },
      { month: '2027-04', key: 'rent', value: 300_000 },
    ]);
  });
});

describe('forecast scenarios', () => {
  it('creates, edits, copies, compares and deletes scenarios', async () => {
    await seedBooks();
    const a = await createForecast(prisma, { name: 'Expected', actorUserId: admin, now: NOW });
    const detail = await forecastDetail(prisma, a.id);
    expect(detail.forecast.number).toBe('FC-000001');
    expect(detail.months).toEqual(forecastMonths('2026-11'));
    expect(detail.forecast.basedOnFrom).toBe('2026-08');
    const m0 = detail.result.months[0]!;
    expect(m0.orders).toBe(18);
    expect(m0.lines['fee:order_fee']).toBe(36_000);
    for (const m of detail.result.months)
      expect(m.balanceSheet.totalAssets).toBe(
        m.balanceSheet.totalLiabilities + m.balanceSheet.totalEquity,
      );

    await saveForecastDrivers(prisma, {
      forecastId: a.id,
      changes: [{ month: '2026-11', key: 'orders', value: 100 }],
      actorUserId: admin,
    });
    await saveForecastOverrides(prisma, {
      forecastId: a.id,
      changes: [{ month: '2026-12', lineKey: 'rent', amountPiastres: 1, note: 'Free month' }],
      actorUserId: admin,
    });
    const edited = await forecastDetail(prisma, a.id);
    expect(edited.result.months[0]!.orders).toBe(100);
    expect(edited.result.months[1]!.lines.rent).toBe(1);
    expect(edited.result.months[1]!.edited).toEqual(['rent']);
    expect(edited.overrides[0]).toMatchObject({ note: 'Free month', updatedBy: { id: admin } });
    expect(
      await prisma.auditLog.count({ where: { action: 'finance.forecast_edit', entityId: a.id } }),
    ).toBe(2);

    await expect(
      saveForecastDrivers(prisma, {
        forecastId: a.id,
        changes: [{ month: '2030-01', key: 'rent', value: 1 }],
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'month_outside_forecast' });

    const b = await createForecast(prisma, {
      name: 'Best case',
      copyFromId: a.id,
      actorUserId: admin,
    });
    const copy = await forecastDetail(prisma, b.id);
    expect(copy.forecast.copiedFrom?.id).toBe(a.id);
    expect(copy.result.months.map((m) => m.profit)).toEqual(
      edited.result.months.map((m) => m.profit),
    );
    const compared = await compareForecasts(prisma, [a.id, b.id]);
    expect(compared.map((c) => c.name)).toEqual(['Expected', 'Best case']);
    expect((await listForecasts(prisma)).map((x) => x.number)).toEqual(['FC-000002', 'FC-000001']);

    await setForecastStatus(prisma, { forecastId: a.id, status: 'approved', actorUserId: admin });
    await expect(
      saveForecastDrivers(prisma, {
        forecastId: a.id,
        changes: [{ month: '2026-11', key: 'rent', value: 1 }],
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'forecast_approved' });
    await expect(
      deleteForecast(prisma, { forecastId: a.id, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'forecast_approved' });
    await deleteForecast(prisma, { forecastId: b.id, actorUserId: admin });
    expect(await prisma.forecastDriver.count({ where: { forecastId: b.id } })).toBe(0);
  });
});

describe('use as budget', () => {
  it('needs an approved scenario, then replaces or skips existing budget rows', async () => {
    const { rent } = await seedBooks();
    const a = await createForecast(prisma, { name: 'Expected', actorUserId: admin, now: NOW });
    await expect(
      forecastToBudget(prisma, { forecastId: a.id, mode: 'replace', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'forecast_not_approved' });
    await setForecastStatus(prisma, { forecastId: a.id, status: 'approved', actorUserId: admin });

    // Budgets already there: rent for November (company wide) and a store's rent.
    await setBudget(prisma, {
      month: '2026-11',
      accountId: rent.id,
      amountPiastres: 123,
      actorUserId: admin,
    });
    await setBudget(prisma, {
      month: '2026-11',
      accountId: rent.id,
      darkStoreId: f.store.id,
      amountPiastres: 77,
      actorUserId: admin,
    });

    const preview = await forecastBudgetPreview(prisma, a.id);
    expect(preview.existing).toBe(1);
    const rentNov = preview.rows.find((r) => r.month === '2026-11' && r.accountId === rent.id)!;
    expect(rentNov).toMatchObject({ amountPiastres: 300_000, existingPiastres: 123 });

    const skipped = await forecastToBudget(prisma, {
      forecastId: a.id,
      mode: 'skip',
      actorUserId: admin,
    });
    expect(skipped.skippedExisting).toBe(1);
    const budget = (month: string, accountId: string, darkStoreId: string | null = null) =>
      prisma.budget.findFirst({ where: { month, accountId, darkStoreId } });
    expect((await budget('2026-11', rent.id))!.amountPiastres).toBe(123);
    expect((await budget('2026-12', rent.id))!.amountPiastres).toBe(300_000);
    const fees = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'revenue' } });
    expect((await budget('2026-11', fees.id))!.amountPiastres).toBe(36_000);

    const replaced = await forecastToBudget(prisma, {
      forecastId: a.id,
      mode: 'replace',
      actorUserId: admin,
    });
    expect(replaced.skippedExisting).toBe(0);
    expect((await budget('2026-11', rent.id))!.amountPiastres).toBe(300_000);
    // A store's own budget is never touched.
    expect((await budget('2026-11', rent.id, f.store.id))!.amountPiastres).toBe(77);
    expect(
      await prisma.auditLog.count({
        where: { action: 'finance.forecast_to_budget', entityId: a.id },
      }),
    ).toBe(2);
  });
});
