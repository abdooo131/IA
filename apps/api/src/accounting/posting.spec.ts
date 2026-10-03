import { ACC, cashoutFee, cashoutPaid, codCollected, deliveredSettlement, deposit, failedFeeAmounts, failedSettlement, finalize, Line, merchantAdjustment, OrderMoney, reversal } from './posting';

const order: OrderMoney = {
  id: 'o1', merchantId: 'm1', trackingNumber: 'SHP0000010009',
  codAmount: 45000, shippingFee: 8000, codFee: 0, openPackageFee: 700, vatAmount: 1218, totalFees: 9918,
  failedDeliveryFee: 4800,
  pricingSnapshot: { input: { vatEnabled: true }, config: { vatRateBp: 1400 } },
};
const sum = (ls: Line[], side: 'debit' | 'credit') => ls.reduce((s, l) => s + (l[side] ?? 0), 0);
const net = (ls: Line[], account: string) => ls.filter((l) => l.account === account).reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0);

describe('posting rules', () => {
  it('COD collected: cash with drivers up, owed to merchant pending settlement', () => {
    const ls = codCollected(order);
    expect(sum(ls, 'debit')).toBe(45000);
    expect(net(ls, ACC.CASH_WITH_DRIVERS)).toBe(-45000);
    expect(net(ls, ACC.COD_AWAITING_SETTLEMENT)).toBe(45000);
  });

  it('delivered settlement: wallet gets COD minus frozen fees, revenue and VAT split out', () => {
    const ls = deliveredSettlement(order);
    expect(sum(ls, 'debit')).toBe(sum(ls, 'credit'));
    expect(net(ls, ACC.MERCHANT_WALLETS)).toBe(45000 - 9918);
    expect(net(ls, ACC.REV_SHIPPING)).toBe(8000);
    expect(net(ls, ACC.REV_OPEN_PACKAGE)).toBe(700);
    expect(net(ls, ACC.VAT_PAYABLE)).toBe(1218);
    expect(net(ls, ACC.COD_AWAITING_SETTLEMENT)).toBe(-45000);
    expect(ls.some((l) => l.account === ACC.REV_COD_FEE)).toBe(false); // zero lines dropped
  });

  it('prepaid delivery (no COD) still charges fees, wallet goes down', () => {
    const ls = deliveredSettlement({ ...order, codAmount: 0 });
    expect(net(ls, ACC.MERCHANT_WALLETS)).toBe(-9918);
  });

  it('failed delivery: 48 EGP plus VAT from the frozen snapshot', () => {
    expect(failedFeeAmounts(order)).toEqual({ fee: 4800, vat: 672 });
    const ls = failedSettlement(order);
    expect(net(ls, ACC.MERCHANT_WALLETS)).toBe(-5472);
    expect(net(ls, ACC.REV_FAILED_DELIVERY)).toBe(4800);
  });

  it('failed delivery for a merchant without VAT has no VAT line', () => {
    const ls = failedSettlement({ ...order, pricingSnapshot: { input: { vatEnabled: false }, config: { vatRateBp: 1400 } } });
    expect(ls.find((l) => l.account === ACC.VAT_PAYABLE)).toBeUndefined();
    expect(net(ls, ACC.MERCHANT_WALLETS)).toBe(-4800);
  });

  it('cashout fees: bank flat 15 EGP, Fawry 1%', () => {
    const cfg = { bankFlat: 1500, fawryAccountBp: 100, fawryCardBp: 100 };
    expect(cashoutFee('BANK', 100000, cfg)).toBe(1500);
    expect(cashoutFee('FAWRY_ACCOUNT', 100000, cfg)).toBe(1000);
    expect(cashoutFee('FAWRY_CARD', 25050, cfg)).toBe(251);
  });

  it('cashout paid: wallet down by gross, bank pays net, fee is revenue', () => {
    const ls = cashoutPaid('m1', 100000, 1500);
    expect(net(ls, ACC.MERCHANT_WALLETS)).toBe(-100000);
    expect(net(ls, ACC.BANK)).toBe(98500);
    expect(net(ls, ACC.REV_CASHOUT_FEE)).toBe(1500);
  });

  it('deposits move cash between drivers, Fawry and bank', () => {
    expect(net(deposit('DRIVER_TO_FAWRY', 500, 'x'), ACC.CASH_WITH_DRIVERS)).toBe(500);
    expect(net(deposit('DRIVER_TO_FAWRY', 500, 'x'), ACC.FAWRY_RECEIVABLE)).toBe(-500);
    expect(net(deposit('FAWRY_SETTLEMENT', 500, 'x'), ACC.BANK)).toBe(-500);
  });

  it('adjustments credit or debit the merchant wallet', () => {
    expect(net(merchantAdjustment('COMPENSATION', 'm1', 300, 'lost'), ACC.MERCHANT_WALLETS)).toBe(300);
    expect(net(merchantAdjustment('DEDUCTION', 'm1', 300, 'damage'), ACC.MERCHANT_WALLETS)).toBe(-300);
  });

  it('reversal mirrors every line', () => {
    const orig = merchantAdjustment('COMPENSATION', 'm1', 300, 'lost').map((l) => ({
      accountCode: l.account, debit: l.debit ?? 0, credit: l.credit ?? 0, merchantId: l.merchantId ?? null, orderId: null, memo: l.memo ?? null,
    }));
    const r = reversal(orig);
    expect(net(r, ACC.MERCHANT_WALLETS)).toBe(-300);
  });

  it('rejects unbalanced, fractional or single line journals', () => {
    expect(() => finalize([{ account: '1010', debit: 100 }, { account: '2010', credit: 99 }])).toThrow(/Unbalanced/);
    expect(() => finalize([{ account: '1010', debit: 1.5 }, { account: '2010', credit: 1.5 }])).toThrow(/integers/);
    expect(() => finalize([{ account: '1010', debit: 0 }, { account: '2010', credit: 0 }, { account: '3010', debit: 5, credit: 5 }])).toThrow();
  });
});
