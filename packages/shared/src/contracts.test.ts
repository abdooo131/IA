import { describe, expect, it } from 'vitest';
import {
  chequeLabel,
  chequeSchema,
  contractLabel,
  contractVersionSchema,
  makeTier,
  monthEstimate,
  orderCharge,
  resolvePrices,
  tierFor,
  whatIf,
} from './contracts';

describe('contract tiers', () => {
  const tiers = [
    makeTier(1, { fixedFeePiastres: 2_500 }),
    makeTier(101, { fixedFeePiastres: 2_000, codPercentBp: 50 }),
    makeTier(501, { fixedFeePiastres: 1_500, percentBp: 50, storagePerUnitMonthPiastres: 0 }),
  ];
  it('picks the band the order falls in, from the order that crosses it', () => {
    expect(tierFor(tiers, 1)?.fixedFeePiastres).toBe(2_500);
    expect(tierFor(tiers, 100)?.fixedFeePiastres).toBe(2_500);
    expect(tierFor(tiers, 101)?.fixedFeePiastres).toBe(2_000);
    expect(tierFor(tiers, 9_999)?.fromOrder).toBe(501);
    expect(tierFor(tiers.slice(1), 50)).toBeNull();
    expect(tierFor([], 1)).toBeNull();
  });

  it('resolves every price field by field: band, then the version, then the standard', () => {
    const standard = {
      orderFixedPiastres: 3_000,
      orderPercentBp: 100,
      codPercentBp: 150,
      failedDeliveryPiastres: 2_000,
      receivingPerUnitPiastres: 50,
      storagePerUnitMonthPiastres: 100,
      returnPerUnitPiastres: 200,
    };
    const version = {
      orderFixedPiastres: null,
      orderPercentBp: 0,
      codPercentBp: 120,
      failedDeliveryPiastres: null,
      receivingPerUnitPiastres: 40,
      storagePerUnitMonthPiastres: null,
      returnPerUnitPiastres: null,
    };
    expect(resolvePrices(version, null, standard)).toEqual({
      ...standard,
      orderPercentBp: 0,
      codPercentBp: 120,
      receivingPerUnitPiastres: 40,
    });
    expect(resolvePrices(version, tierFor(tiers, 120), standard)).toMatchObject({
      orderFixedPiastres: 2_000,
      codPercentBp: 50,
      receivingPerUnitPiastres: 40,
    });
    // A band may set a price to zero (free storage from the 501st order).
    expect(resolvePrices(version, tierFor(tiers, 600), standard).storagePerUnitMonthPiastres).toBe(
      0,
    );
    expect(resolvePrices(null, null, standard)).toEqual(standard);
  });

  it('refuses a band twice, an empty band and an end before the start', () => {
    const base = {
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
      startDate: '2026-11-01',
      endDate: null,
      noticeDays: 30,
      minimumMonthlyFeePiastres: null,
      securityDepositPiastres: null,
      creditLimitPiastres: null,
      tiers: [],
    };
    expect(contractVersionSchema.safeParse(base).success).toBe(true);
    expect(
      contractVersionSchema.safeParse({
        ...base,
        tiers: [
          { fromOrder: 1, fixedFeePiastres: 1 },
          { fromOrder: 1, returnPerUnitPiastres: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(contractVersionSchema.safeParse({ ...base, tiers: [{ fromOrder: 1 }] }).success).toBe(
      false,
    );
    const parsed = contractVersionSchema.parse({
      ...base,
      tiers: [{ fromOrder: 5, failedDeliveryPiastres: 0 }],
    });
    expect(parsed.tiers[0]).toEqual(makeTier(5, { failedDeliveryPiastres: 0 }));
    expect(contractVersionSchema.safeParse({ ...base, endDate: '2026-10-31' }).success).toBe(false);
    expect(contractLabel(7)).toBe('CTR-000007');
  });
});

describe('contract calculator', () => {
  const standard = {
    orderFixedPiastres: 2_500,
    orderPercentBp: 100,
    codPercentBp: 100,
    failedDeliveryPiastres: 1_500,
    receivingPerUnitPiastres: 50,
    storagePerUnitMonthPiastres: 300,
    returnPerUnitPiastres: 200,
  };
  const none = {
    orderFixedPiastres: null,
    orderPercentBp: null,
    codPercentBp: null,
    failedDeliveryPiastres: null,
    receivingPerUnitPiastres: null,
    storagePerUnitMonthPiastres: null,
    returnPerUnitPiastres: null,
  };
  const terms = {
    ...none,
    orderFixedPiastres: 2_000,
    tiers: [makeTier(101, { fixedFeePiastres: 1_500, codPercentBp: 50 })],
    minimumMonthlyFeePiastres: null,
  };

  it('prices one cash order at its band, with VAT', () => {
    // 400 EGP cash: 20 + 1% of 400 = 24 EGP order fee, 1% of 400 = 4 EGP COD fee.
    const first = orderCharge(terms, standard, 1_400, {
      productsPiastres: 40_000,
      cashPiastres: 40_000,
    });
    expect(first).toMatchObject({
      tierFrom: null,
      orderFeePiastres: 2_400,
      codFeePiastres: 400,
      feesPiastres: 2_800,
      vatPiastres: 392,
      totalPiastres: 3_192,
    });
    const later = orderCharge(terms, standard, 0, {
      productsPiastres: 40_000,
      cashPiastres: 0,
      nth: 150,
    });
    expect(later).toMatchObject({ tierFrom: 101, orderFeePiastres: 1_900, codFeePiastres: 0 });
  });

  it('estimates a month band by band, storage day by day, topped up to the minimum', () => {
    const month = monthEstimate(terms, standard, 0, {
      orders: 150,
      averageOrderPiastres: 40_000,
      unitsStored: 100,
    });
    // 100 orders at 24 + 4 EGP, 50 at 19 + 2 EGP; 100 units at 3 EGP a month.
    expect(month.orderFeesPiastres).toBe(100 * 2_400 + 50 * 1_900);
    expect(month.codFeesPiastres).toBe(100 * 400 + 50 * 200);
    expect(month.storagePiastres).toBe(30_000);
    expect(month.feesPiastres).toBe(415_000);
    const minimum = monthEstimate({ ...terms, minimumMonthlyFeePiastres: 1_000_000 }, standard, 0, {
      orders: 150,
      averageOrderPiastres: 40_000,
      unitsStored: 100,
    });
    expect(minimum).toMatchObject({ minimumTopUpPiastres: 585_000, feesPiastres: 1_000_000 });
    expect(
      monthEstimate(terms, standard, 0, { orders: 0, averageOrderPiastres: 0, unitsStored: 0 }),
    ).toMatchObject({ feesPiastres: 0, perOrderPiastres: null });
  });
});

describe('cheques', () => {
  it('numbers the register and matches purpose to direction', () => {
    expect(chequeLabel(12)).toBe('CHQ-000012');
    const cheque = {
      direction: 'received',
      purpose: 'merchant',
      chequeNumber: '1',
      amountPiastres: 100,
      issueDate: '2026-11-01',
      dueDate: '2026-11-30',
      idempotencyKey: 'key-12345',
    };
    expect(chequeSchema.safeParse(cheque).success).toBe(true);
    expect(chequeSchema.safeParse({ ...cheque, purpose: 'bill' }).success).toBe(false);
    expect(chequeSchema.safeParse({ ...cheque, dueDate: '2026-10-01' }).success).toBe(false);
  });
});

describe('what if', () => {
  const base = {
    deliveredOrders: 100,
    productsPiastres: 5_000_000,
    codCashPiastres: 4_000_000,
    feesByKind: { order_fee: 250_000, cod_fee: 40_000, storage_fee: 10_000 },
    costsPiastres: 200_000,
  };
  it('works order and COD fees out again, keeps the rest and tops up to the minimum', () => {
    const same = whatIf(base, {
      orderFixedPiastres: 2_500,
      orderPercentBp: 0,
      codPercentBp: 100,
      minimumPiastres: null,
    });
    expect(same).toMatchObject({ feesPiastres: 300_000, marginPiastres: 100_000 });
    expect(same.marginPerOrderPiastres).toBe(1_000);
    const cheaper = whatIf(base, {
      orderFixedPiastres: 1_000,
      orderPercentBp: 100,
      codPercentBp: 0,
      minimumPiastres: 400_000,
    });
    // 100 000 fixed + 50 000 (1% of products) + 10 000 storage, topped up to 4,000 EGP.
    expect(cheaper).toMatchObject({
      orderFeePiastres: 150_000,
      codFeePiastres: 0,
      otherFeesPiastres: 10_000,
      minimumTopUpPiastres: 240_000,
      feesPiastres: 400_000,
      marginPiastres: 200_000,
    });
    const none = {
      orderFixedPiastres: 0,
      orderPercentBp: 0,
      codPercentBp: 0,
      minimumPiastres: null,
    };
    expect(whatIf({ ...base, deliveredOrders: 0 }, none).marginPerOrderPiastres).toBeNull();
  });
});
