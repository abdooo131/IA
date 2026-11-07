import { makeTier } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  bodyFrom,
  calculate,
  type ContractVersion,
  formFrom,
  newTierRow,
  parsePrice,
  parseTierRows,
  priceInput,
  shownVersion,
  tierColumns,
  tierRowsFrom,
} from './contracts';
import { merchantTabs, pickMerchantTab } from './merchant-page';

const standard = {
  orderFixedPiastres: 2_500,
  orderPercentBp: 100,
  codPercentBp: 100,
  failedDeliveryPiastres: 1_500,
  receivingPerUnitPiastres: 50,
  storagePerUnitMonthPiastres: 300,
  returnPerUnitPiastres: 200,
};
const noPrices = {
  orderFixedPiastres: null,
  orderPercentBp: null,
  codPercentBp: null,
  failedDeliveryPiastres: null,
  receivingPerUnitPiastres: null,
  storagePerUnitMonthPiastres: null,
  returnPerUnitPiastres: null,
};
const version = (over: Partial<ContractVersion> = {}): ContractVersion => ({
  id: 'v1',
  version: 1,
  label: 'CTR-000001 v1',
  status: 'active',
  displayStatus: 'in_force',
  effectiveFrom: '2026-11-01',
  prices: { ...noPrices, orderFixedPiastres: 2_000, codPercentBp: 80 },
  tiers: [makeTier(201, { fixedFeePiastres: 1_500, codPercentBp: 50 })],
  payoutSchedule: 'twice_weekly',
  minimumPayoutPiastres: 50_000,
  minimumMonthlyFeePiastres: null,
  securityDepositPiastres: 100_000,
  creditLimitPiastres: null,
  promiseMinutes: 60,
  deliveryAttempts: 3,
  storeIds: [],
  coverageNote: null,
  terms: 'Free packaging',
  internalNote: null,
  startDate: '2026-11-01',
  endDate: null,
  noticeDays: 30,
  noticeBy: null,
  source: null,
  createdAt: '2026-11-01T08:00:00Z',
  createdBy: null,
  activatedAt: null,
  activatedBy: null,
  ...over,
});

describe('contract form', () => {
  it('shows prices in pounds and percent, empty for the standard price', () => {
    expect(priceInput('orderFixedPiastres', 1850)).toBe('18.50');
    expect(priceInput('codPercentBp', 80)).toBe('0.8');
    expect(priceInput('returnPerUnitPiastres', null)).toBe('');
    expect(parsePrice('orderFixedPiastres', '18.5')).toBe(1850);
    expect(parsePrice('orderPercentBp', '1.25')).toBe(125);
    expect(parsePrice('orderPercentBp', '')).toBeNull();
    expect(parsePrice('codPercentBp', 'abc')).toBeNaN();
  });

  it('reads the tier table: a first order and at least one price each, never twice', () => {
    const rows = tierRowsFrom([
      makeTier(501, { fixedFeePiastres: 1200, storagePerUnitMonthPiastres: 0 }),
    ]);
    expect(rows[0]!.fromOrder).toBe('501');
    expect(rows[0]!.values.storagePerUnitMonthPiastres).toBe('0.00');
    expect(newTierRow(rows).fromOrder).toBe('601');
    expect(newTierRow([]).fromOrder).toBe('101');
    const blank = newTierRow([]);
    expect(
      parseTierRows([
        { ...blank, fromOrder: '1001', values: { ...blank.values, codPercentBp: '0.5' } },
        ...rows,
        { ...blank, fromOrder: '' },
      ]),
    ).toEqual([
      makeTier(501, { fixedFeePiastres: 1200, storagePerUnitMonthPiastres: 0 }),
      makeTier(1001, { codPercentBp: 50 }),
    ]);
    // A band without a price, twice the same band, or a wrong value is refused.
    expect(parseTierRows([{ ...blank, fromOrder: '10' }])).toBeNull();
    expect(parseTierRows([...rows, ...rows])).toBeNull();
    expect(
      parseTierRows([
        { ...blank, fromOrder: '10', values: { ...blank.values, codPercentBp: '200' } },
      ]),
    ).toBeNull();
    expect(
      tierColumns([makeTier(1, { returnPerUnitPiastres: 0 }), makeTier(5, { percentBp: 10 })]),
    ).toEqual(['orderPercentBp', 'returnPerUnitPiastres']);
  });

  it('turns the form into the API body, or names the first thing to fix', () => {
    const form = formFrom(version(), '2026-11-07');
    expect(form.prices.orderFixedPiastres).toBe('20.00');
    expect(form.prices.orderPercentBp).toBe('');
    // A new draft takes effect today unless another day is chosen.
    expect(form.effectiveFrom).toBe('2026-11-07');
    const ok = bodyFrom(form);
    expect(ok).toMatchObject({
      ok: true,
      body: {
        orderFixedPiastres: 2000,
        orderPercentBp: null,
        codPercentBp: 80,
        payoutSchedule: 'twice_weekly',
        minimumPayoutPiastres: 50_000,
        securityDepositPiastres: 100_000,
        promiseMinutes: 60,
        deliveryAttempts: 3,
        terms: 'Free packaging',
        noticeDays: 30,
      },
    });
    expect(bodyFrom({ ...form, prices: { ...form.prices, codPercentBp: 'x' } })).toEqual({
      ok: false,
      error: 'price',
    });
    expect(bodyFrom({ ...form, deliveryAttempts: '0' })).toEqual({ ok: false, error: 'attempts' });
    expect(bodyFrom({ ...form, promiseMinutes: '5' })).toEqual({ ok: false, error: 'promise' });
    expect(bodyFrom({ ...form, endDate: '2026-10-01' })).toEqual({ ok: false, error: 'dates' });
    expect(formFrom(null, '2026-11-07')).toMatchObject({
      startDate: '2026-11-07',
      noticeDays: '30',
    });
  });

  it('shows the version in force, else the next agreed one', () => {
    const now = version();
    const later = version({ id: 'v2', displayStatus: 'scheduled' });
    const view = { current: now, scheduled: [later], versions: [later, now] } as never;
    expect(shownVersion(view)?.id).toBe('v1');
    expect(shownVersion(view, 'v2')?.id).toBe('v2');
    expect(
      shownVersion({ current: null, scheduled: [later], versions: [later] } as never)?.id,
    ).toBe('v2');
  });
});

describe('contract calculator', () => {
  it('prices a cash order and a month at the contract, falling back to the standard', () => {
    const r = calculate(version(), standard, 1_400, {
      orderPiastres: 40_000,
      orders: 300,
      unitsStored: 0,
    });
    // 400 EGP cash: 20 EGP + 1% of 400 (standard share) = 24 EGP, COD 0.8% = 3.20 EGP.
    expect(r.order).toMatchObject({
      orderFeePiastres: 2_400,
      codFeePiastres: 320,
      feesPiastres: 2_720,
    });
    expect(r.order.vatPiastres).toBe(336 + 45);
    // 200 orders at 24 + 3.20, then 100 at 19 + 2 EGP.
    expect(r.month.orderFeesPiastres).toBe(200 * 2_400 + 100 * 1_900);
    expect(r.month.codFeesPiastres).toBe(200 * 320 + 100 * 200);
    const none = calculate(null, standard, 0, {
      orderPiastres: 40_000,
      orders: 10,
      unitsStored: 300,
    });
    expect(none.order.feesPiastres).toBe(2_500 + 400 + 400);
    // 300 units at 3 EGP a month.
    expect(none.month.storagePiastres).toBe(90_000);
  });
});

describe('merchant page tabs', () => {
  it('shows Profit only with Accounting and falls back to the overview', () => {
    expect(merchantTabs({ canProfit: false })).not.toContain('profit');
    expect(merchantTabs({ canProfit: true })).toContain('profit');
    expect(pickMerchantTab('contract', merchantTabs({ canProfit: false }))).toBe('contract');
    expect(pickMerchantTab('profit', merchantTabs({ canProfit: false }))).toBe('overview');
    expect(pickMerchantTab(undefined, merchantTabs({ canProfit: true }))).toBe('overview');
  });
});
