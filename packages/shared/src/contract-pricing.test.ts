import { describe, expect, it } from 'vitest';
import {
  allInclusivePrices,
  contractProductPriceRowSchema,
  contractVersionSchema,
  egpTextToPiastres,
  failedDeliveryCharge,
  failedDeliveryRule,
  makeTier,
  productHandlingCharge,
  shipmentCharges,
} from './contracts';
import { exampleMonth, packageDiscountBp, proposalApproval } from './crm-sales';

const standard = {
  shippingFeePiastres: 0,
  packagingChargePiastres: 0,
  orderFixedPiastres: 2_000,
  orderPercentBp: 100,
  codPercentBp: 150,
  failedDeliveryPiastres: 1_500,
  receivingPerUnitPiastres: 50,
  storagePerUnitMonthPiastres: 300,
  returnPerUnitPiastres: 200,
};

describe('contract pricing rules', () => {
  it('reads pounds as piastres without floats', () => {
    expect(egpTextToPiastres('120')).toBe(12_000);
    expect(egpTextToPiastres('1,200.5')).toBe(120_050);
    expect(egpTextToPiastres('٣٫')).toBeNull();
    expect(egpTextToPiastres('٣')).toBe(300);
    expect(egpTextToPiastres('0.1')).toBe(10);
    expect(egpTextToPiastres('1.234')).toBeNull();
    expect(egpTextToPiastres('-1')).toBeNull();
    expect(contractProductPriceRowSchema.safeParse({ sku: 'A', price_egp: 12.5 }).data).toEqual({
      sku: 'A',
      price_egp: 1_250,
    });
  });

  it('sums per product prices over units, products without a price count nothing', () => {
    const prices = new Map([['a', 300]]);
    expect(
      productHandlingCharge(
        [
          { skuId: 'a', units: 3 },
          { skuId: 'b', units: 5 },
          { skuId: 'a', units: 0 },
        ],
        prices,
      ),
    ).toBe(900);
  });

  it('picks the failed delivery rule: fixed set, then share set, then a shipping fee, then fixed', () => {
    const resolved = { failedDeliveryPiastres: 1_500, shippingFeePiastres: 0 };
    expect(failedDeliveryRule(null, null, resolved, 10_000)).toEqual({
      mode: 'fixed',
      piastres: 1_500,
    });
    expect(
      failedDeliveryRule(null, null, { ...resolved, shippingFeePiastres: 12_000 }, 10_000),
    ).toEqual({ mode: 'percent', bp: 10_000 });
    expect(failedDeliveryRule({ failedDeliveryPercentBp: 5_000 }, null, resolved, 10_000)).toEqual({
      mode: 'percent',
      bp: 5_000,
    });
    // A fixed fee present wins, 0 included; a band may set it too.
    expect(
      failedDeliveryRule(
        { failedDeliveryPiastres: 0, failedDeliveryPercentBp: 5_000 },
        null,
        resolved,
        10_000,
      ),
    ).toEqual({ mode: 'fixed', piastres: 0 });
    expect(
      failedDeliveryRule(
        { failedDeliveryPercentBp: 5_000 },
        makeTier(10, { failedDeliveryPiastres: 700 }),
        resolved,
        10_000,
      ),
    ).toEqual({ mode: 'fixed', piastres: 700 });
    const shipment = shipmentCharges(
      { shippingFeePiastres: 12_000, orderFixedPiastres: 1_000, orderPercentBp: 100 },
      { productsPiastres: 30_000, productHandlingPiastres: 600 },
    );
    expect(shipment).toBe(12_000 + 600 + 1_000 + 300);
    expect(failedDeliveryCharge({ mode: 'percent', bp: 5_000 }, shipment)).toBe(6_950);
  });

  it('keeps 0 apart from empty in a version, the preset sets explicit zeros', () => {
    const base = {
      orderFixedPiastres: null,
      orderPercentBp: null,
      codPercentBp: null,
      failedDeliveryPiastres: null,
      receivingPerUnitPiastres: null,
      storagePerUnitMonthPiastres: null,
      returnPerUnitPiastres: null,
      tiers: [],
      payoutSchedule: null,
      minimumPayoutPiastres: null,
      minimumMonthlyFeePiastres: null,
      securityDepositPiastres: null,
      creditLimitPiastres: null,
      promiseMinutes: null,
      deliveryAttempts: null,
      startDate: '2026-11-01',
      endDate: null,
      noticeDays: 30,
    };
    const empty = contractVersionSchema.parse(base);
    expect(empty).toMatchObject({
      shippingFeePiastres: null,
      packagingChargePiastres: null,
      failedDeliveryPercentBp: null,
      productPrices: [],
    });
    const preset = contractVersionSchema.parse({ ...base, ...allInclusivePrices(12_000) });
    expect(preset).toMatchObject({
      shippingFeePiastres: 12_000,
      orderFixedPiastres: 0,
      codPercentBp: 0,
      packagingChargePiastres: 0,
      failedDeliveryPiastres: null,
      failedDeliveryPercentBp: 10_000,
    });
    expect(
      contractVersionSchema.safeParse({
        ...base,
        productPrices: [
          { skuId: 'a', pricePiastres: 1 },
          { skuId: 'a', pricePiastres: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('proposals with a shipping fee', () => {
  const list = { ...standard };
  it('price the example month with shipping and packaging', () => {
    const month = exampleMonth({
      ...list,
      ...allInclusivePrices(12_000),
      shippingFeePiastres: 12_000,
      packagingChargePiastres: 100,
      expectedMonthlyOrders: 10,
      averageOrderPiastres: 40_000,
      minimumMonthlyFeePiastres: null,
      tiers: [makeTier(6, { shippingFeePiastres: 10_000 })],
    } as never);
    expect(month).toMatchObject({
      shippingFeesPiastres: 5 * 12_000 + 5 * 10_000,
      packagingChargesPiastres: 1_000,
      orderFeesPiastres: 0,
      codFeesPiastres: 0,
      totalPiastres: 111_000,
    });
  });

  it('check an all inclusive proposal as a whole against the settings month', () => {
    const offer = {
      ...list,
      ...allInclusivePrices(2_000),
      shippingFeePiastres: 2_000,
      packagingChargePiastres: 0,
      tiers: [],
      expectedMonthlyOrders: 100,
      averageOrderPiastres: 40_000,
    } as never;
    // The settings month: 20 EGP + 1% of 400 + 1.5% of 400 = 30 EGP an order; offered 20 EGP.
    expect(packageDiscountBp(offer, list)).toBe(3_333);
    expect(proposalApproval(offer, list, 2_000)).toEqual({
      maxDiscountBp: 3_333,
      needsApproval: true,
    });
    expect(
      proposalApproval({ ...(offer as object), shippingFeePiastres: 3_000 } as never, list, 2_000),
    ).toEqual({ maxDiscountBp: 0, needsApproval: false });
  });
});
