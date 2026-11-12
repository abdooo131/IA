import { exampleMonth, makeTier, proposalApproval } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import {
  bpText,
  feeInput,
  monthNeighbours,
  parseFee,
  parsePercentBp,
  pickMonth,
  progressWidth,
  proposalActions,
  proposalLink,
  setupLink,
} from './sales-part2';

const list = {
  orderFixedPiastres: 2000,
  orderPercentBp: 100,
  codPercentBp: 150,
  failedDeliveryPiastres: 1500,
  receivingPerUnitPiastres: 100,
  storagePerUnitMonthPiastres: 50,
  returnPerUnitPiastres: 200,
  shippingFeePiastres: 0,
  packagingChargePiastres: 0,
};

describe('proposal form values', () => {
  it('reads percents as basis points without floats', () => {
    expect(parsePercentBp('1.5')).toBe(150);
    expect(parsePercentBp('20')).toBe(2000);
    expect(parsePercentBp('0.05')).toBe(5);
    expect(parsePercentBp('١٫٥'.replace('٫', '.'))).toBe(150);
    expect(parsePercentBp('100.01')).toBeNull();
    expect(parsePercentBp('1.234')).toBeNull();
    expect(parsePercentBp('abc')).toBeNull();
    expect(bpText(150)).toBe('1.5');
    expect(bpText(105)).toBe('1.05');
    expect(bpText(2000)).toBe('20');
  });

  it('shows money in pounds and shares in percent', () => {
    expect(feeInput('orderFixedPiastres', 2050)).toBe('20.50');
    expect(feeInput('codPercentBp', 150)).toBe('1.5');
    expect(parseFee('orderFixedPiastres', '18.5')).toBe(1850);
    expect(parseFee('orderPercentBp', '2')).toBe(200);
  });

  it('flags a discount past the limit, tiers included', () => {
    expect(proposalApproval({ ...list, tiers: [] }, list, 2000).needsApproval).toBe(false);
    expect(proposalApproval({ ...list, orderFixedPiastres: 1600, tiers: [] }, list, 2000)).toEqual({
      maxDiscountBp: 2000,
      needsApproval: false,
    });
    expect(
      proposalApproval({ ...list, tiers: [makeTier(100, { fixedFeePiastres: 1000 })] }, list, 2000),
    ).toEqual({ maxDiscountBp: 5000, needsApproval: true });
  });

  it('works out the example month band by band, up to the minimum', () => {
    const month = exampleMonth({
      ...list,
      expectedMonthlyOrders: 1000,
      averageOrderPiastres: 50_000,
      minimumMonthlyFeePiastres: null,
      tiers: [makeTier(501, { fixedFeePiastres: 1500 })],
    });
    // 500 × (20 + 5) + 500 × (15 + 5) = 22,500 EGP; COD 1.5% of 500 EGP × 1,000 = 7,500 EGP.
    expect(month).toMatchObject({
      orderFeesPiastres: 2_250_000,
      codFeesPiastres: 750_000,
      totalPiastres: 3_000_000,
      perOrderPiastres: 3000,
    });
    const small = exampleMonth({
      ...list,
      expectedMonthlyOrders: 10,
      averageOrderPiastres: null,
      minimumMonthlyFeePiastres: 100_000,
      tiers: [],
    });
    expect(small).toMatchObject({ minimumTopUpPiastres: 80_000, totalPiastres: 100_000 });
  });
});

describe('proposal actions', () => {
  const base = {
    status: 'draft' as const,
    needsApproval: false,
    approvedAt: null,
    approvalRequestedAt: null,
    confirmedAt: null,
    createdBy: { id: 'rep', name: 'Rep' },
  };
  const rep = { id: 'rep', canEdit: true, canManage: false };
  const manager = { id: 'boss', canEdit: true, canManage: true };

  it('sends a draft within the limit; past it, asks and lets another manager approve', () => {
    expect(proposalActions(base, rep)).toMatchObject({ edit: true, send: true, approve: false });
    const over = { ...base, needsApproval: true };
    expect(proposalActions(over, rep)).toMatchObject({ send: false, requestApproval: true });
    expect(proposalActions(over, manager)).toMatchObject({ approve: true });
    expect(
      proposalActions({ ...over, createdBy: { id: 'boss', name: 'Boss' } }, manager).approve,
    ).toBe(false);
    expect(proposalActions({ ...over, approvedAt: 'x' }, rep).send).toBe(true);
  });

  it('copies the link while it is open and confirms once accepted', () => {
    expect(proposalActions({ ...base, status: 'viewed' }, rep)).toMatchObject({
      copyLink: true,
      edit: false,
    });
    expect(proposalActions({ ...base, status: 'accepted' }, rep).confirm).toBe(true);
    expect(proposalActions({ ...base, status: 'accepted', confirmedAt: 'x' }, rep).confirm).toBe(
      false,
    );
    expect(
      proposalActions({ ...base, status: 'accepted' }, { ...rep, canEdit: false }).confirm,
    ).toBe(false);
    expect(proposalLink('https://shiply.test/', 'abc')).toBe('https://shiply.test/p/abc');
    expect(setupLink('https://shiply.test', 'xyz')).toBe('https://shiply.test/setup/xyz');
  });
});

describe('months and progress', () => {
  it('keeps a valid month, else the current one, and finds its neighbours', () => {
    expect(pickMonth('2026-02', '2026-11')).toBe('2026-02');
    expect(pickMonth('2026-13', '2026-11')).toBe('2026-11');
    expect(pickMonth(undefined, '2026-11')).toBe('2026-11');
    expect(monthNeighbours('2027-01')).toEqual({ previous: '2026-12', next: '2027-02' });
    expect(progressWidth(null)).toBe(0);
    expect(progressWidth(5_000)).toBe(50);
    expect(progressWidth(25_000)).toBe(100);
  });
});
