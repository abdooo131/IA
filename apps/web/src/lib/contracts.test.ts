import { makeTier } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  applyAllInclusive,
  isAllInclusive,
  linesValue,
  parseProductPrices,
  searchProducts,
  setPrices,
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
  shippingFeePiastres: 0,
  packagingChargePiastres: 0,
};
const noPrices = {
  orderFixedPiastres: null,
  orderPercentBp: null,
  codPercentBp: null,
  failedDeliveryPiastres: null,
  receivingPerUnitPiastres: null,
  storagePerUnitMonthPiastres: null,
  returnPerUnitPiastres: null,
  shippingFeePiastres: null,
  packagingChargePiastres: null,
};
const version = (over: Partial<ContractVersion> = {}): ContractVersion => ({
  id: 'v1',
  version: 1,
  label: 'CTR-000001 v1',
  status: 'active',
  displayStatus: 'in_force',
  effectiveFrom: '2026-11-01',
  prices: { ...noPrices, orderFixedPiastres: 2_000, codPercentBp: 80 },
  failedDeliveryPercentBp: null,
  productPrices: [],
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

describe('contract pricing', () => {
  it('applies the all inclusive preset: explicit zeros, never empty', () => {
    const form = applyAllInclusive(formFrom(version(), '2026-11-07'), '120');
    expect(form.prices).toMatchObject({
      shippingFeePiastres: '120',
      orderFixedPiastres: '0',
      orderPercentBp: '0',
      codPercentBp: '0',
      receivingPerUnitPiastres: '0',
      storagePerUnitMonthPiastres: '0',
      returnPerUnitPiastres: '0',
      packagingChargePiastres: '0',
      failedDeliveryPiastres: '',
    });
    expect(form.failedPercent).toBe('100');
    const parsed = bodyFrom(form);
    expect(parsed.ok && parsed.body).toMatchObject({
      shippingFeePiastres: 12_000,
      orderFixedPiastres: 0,
      codPercentBp: 0,
      packagingChargePiastres: 0,
      failedDeliveryPiastres: null,
      failedDeliveryPercentBp: 10_000,
    });
    // Empty stays the standard price.
    const plain = bodyFrom(formFrom(null, '2026-11-07'));
    expect(plain.ok && plain.body).toMatchObject({
      shippingFeePiastres: null,
      packagingChargePiastres: null,
      failedDeliveryPercentBp: null,
      productPrices: [],
    });
    expect(isAllInclusive(parsed.ok ? (parsed.body as never) : noPrices)).toBe(true);
    expect(isAllInclusive(noPrices)).toBe(false);
  });

  it('reads product prices in pounds without floats, sets many at once and searches', () => {
    expect(parseProductPrices({ a: '12.5', b: '', c: '0' })).toEqual([
      { skuId: 'a', pricePiastres: 1_250 },
      { skuId: 'c', pricePiastres: 0 },
    ]);
    expect(parseProductPrices({ a: '1.234' })).toBeNull();
    expect(setPrices({ a: '1', b: '2' }, ['b', 'c'], '7.5')).toEqual({
      a: '1',
      b: '7.5',
      c: '7.5',
    });
    expect(setPrices({ a: '1', b: '2' }, ['a'], '')).toEqual({ b: '2' });
    const form = formFrom(version(), '2026-11-07');
    expect(bodyFrom({ ...form, productPrices: { x: 'abc' } })).toEqual({
      ok: false,
      error: 'productPrice',
    });
    expect(bodyFrom({ ...form, failedPercent: '120' })).toEqual({
      ok: false,
      error: 'failedPercent',
    });
    const products = [
      {
        id: 'a',
        sku: 'TEA-1',
        titleEn: 'Green tea',
        titleAr: 'شاي أخضر',
        pricePiastres: 5_000,
        isActive: false,
      },
      {
        id: 'b',
        sku: 'COF-1',
        titleEn: 'Coffee',
        titleAr: 'قهوة',
        pricePiastres: 9_000,
        isActive: true,
      },
    ];
    expect(searchProducts(products, 'tea').rows.map((p) => p.id)).toEqual(['a']);
    expect(searchProducts(products, 'قهوة').rows.map((p) => p.id)).toEqual(['b']);
    expect(searchProducts(products, '').rows.map((p) => p.id)).toEqual(['b', 'a']);
    expect(
      linesValue(
        [
          { skuId: 'a', quantity: 2 },
          { skuId: 'b', quantity: 1 },
        ],
        products,
      ),
    ).toBe(19_000);
  });

  it('prices an example shipment with its products, cash or prepaid, and its failure', () => {
    const v = version({
      prices: {
        ...noPrices,
        shippingFeePiastres: 12_000,
        orderFixedPiastres: 0,
        orderPercentBp: 0,
        codPercentBp: 100,
        packagingChargePiastres: 0,
      },
      tiers: [],
      productPrices: [{ skuId: 'a', sku: 'TEA-1', titleEn: 'T', titleAr: 'T', pricePiastres: 300 }],
    });
    const lines = [
      { skuId: 'a', quantity: 2 },
      { skuId: 'b', quantity: 1 },
    ];
    const cash = calculate(v, standard, 1_400, {
      orderPiastres: 40_000,
      orders: 100,
      unitsStored: 0,
      lines,
      cash: true,
    });
    expect(cash.order).toMatchObject({
      shippingFeePiastres: 12_000,
      productHandlingPiastres: 600,
      orderFeePiastres: 0,
      codFeePiastres: 400,
      packagingChargePiastres: 0,
      feesPiastres: 13_000,
      vatPiastres: 1_680 + 84 + 56,
      // A shipping fee and no fixed failed fee: 100% of shipping + per product + order fee.
      failedRule: { mode: 'percent', bp: 10_000 },
      failedPiastres: 12_600,
    });
    expect(cash.month).toMatchObject({
      shippingFeesPiastres: 1_200_000,
      productHandlingPiastres: 60_000,
      codFeesPiastres: 40_000,
    });
    const prepaid = calculate(v, standard, 0, {
      orderPiastres: 40_000,
      orders: 1,
      unitsStored: 0,
      lines,
      cash: false,
    });
    expect(prepaid.order.codFeePiastres).toBe(0);
    // A fixed failed fee set on the contract wins.
    const fixed = calculate(
      { ...v, prices: { ...v.prices, failedDeliveryPiastres: 5_000 } },
      standard,
      0,
      { orderPiastres: 40_000, orders: 1, unitsStored: 0, lines },
    );
    expect(fixed.order).toMatchObject({ failedRule: { mode: 'fixed', piastres: 5_000 } });
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
