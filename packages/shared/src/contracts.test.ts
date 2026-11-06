import { describe, expect, it } from 'vitest';
import { chequeLabel, chequeSchema, contractSchema, tierFor, whatIf } from './contracts';

describe('contract tiers', () => {
  const tiers = [
    { fromOrder: 1, fixedFeePiastres: 2_500, percentBp: null },
    { fromOrder: 101, fixedFeePiastres: 2_000, percentBp: null },
    { fromOrder: 501, fixedFeePiastres: 1_500, percentBp: 50 },
  ];
  it('picks the band the order falls in, from the order that crosses it', () => {
    expect(tierFor(tiers, 1)?.fixedFeePiastres).toBe(2_500);
    expect(tierFor(tiers, 100)?.fixedFeePiastres).toBe(2_500);
    expect(tierFor(tiers, 101)?.fixedFeePiastres).toBe(2_000);
    expect(tierFor(tiers, 9_999)?.fromOrder).toBe(501);
    expect(tierFor(tiers.slice(1), 50)).toBeNull();
    expect(tierFor([], 1)).toBeNull();
  });

  it('refuses a band twice, an empty band and an end before the start', () => {
    const base = {
      startDate: '2026-11-01',
      endDate: null,
      noticeDays: 30,
      minimumMonthlyFeePiastres: null,
      securityDepositPiastres: null,
      creditLimitPiastres: null,
      tiers: [],
    };
    expect(contractSchema.safeParse(base).success).toBe(true);
    expect(
      contractSchema.safeParse({
        ...base,
        tiers: [
          { fromOrder: 1, fixedFeePiastres: 1, percentBp: null },
          { fromOrder: 1, fixedFeePiastres: 2, percentBp: null },
        ],
      }).success,
    ).toBe(false);
    expect(
      contractSchema.safeParse({
        ...base,
        tiers: [{ fromOrder: 1, fixedFeePiastres: null, percentBp: null }],
      }).success,
    ).toBe(false);
    expect(contractSchema.safeParse({ ...base, endDate: '2026-10-31' }).success).toBe(false);
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
