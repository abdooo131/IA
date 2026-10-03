/**
 * Posting rules: which accounts each money event debits and credits. Pure functions, no I/O.
 * All amounts are integer piastres. Every rule returns balanced lines (checked again by the database).
 */
import { applyBp } from '../pricing/pricing.engine';

export const ACC = {
  BANK: '1010',
  CASH_WITH_DRIVERS: '1020',
  FAWRY_RECEIVABLE: '1030',
  CASH_IN_HUBS: '1040',
  DRIVER_SHORTAGES: '1050',
  MERCHANT_WALLETS: '2010',
  COD_AWAITING_SETTLEMENT: '2015',
  VAT_PAYABLE: '2020',
  DRIVER_PAYABLE: '2030',
  FRANCHISE_PAYABLE: '2040',
  EQUITY: '3010',
  REV_SHIPPING: '4010',
  REV_COD_FEE: '4020',
  REV_OPEN_PACKAGE: '4030',
  REV_FAILED_DELIVERY: '4040',
  REV_CASHOUT_FEE: '4050',
  REV_OTHER: '4060',
  EXP_DRIVER_EARNINGS: '5010',
  EXP_FRANCHISE: '5020',
  EXP_COMPENSATION: '5030',
  EXP_PAYMENT_FEES: '5040',
} as const;

export interface Line {
  account: string;
  debit?: number;
  credit?: number;
  merchantId?: string | null;
  orderId?: string | null;
  driverId?: string | null;
  memo?: string;
}

export interface OrderMoney {
  id: string;
  merchantId: string;
  trackingNumber: string;
  codAmount: number;
  shippingFee: number;
  codFee: number;
  openPackageFee: number;
  vatAmount: number;
  totalFees: number;
  failedDeliveryFee: number;
  pricingSnapshot: unknown;
}

const dr = (account: string, amount: number, extra: Omit<Line, 'account'> = {}): Line => ({ account, debit: amount, ...extra });
const cr = (account: string, amount: number, extra: Omit<Line, 'account'> = {}): Line => ({ account, credit: amount, ...extra });

/** Drops zero lines and verifies the journal balances. */
export function finalize(lines: Line[]): Line[] {
  const out = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  for (const l of out) {
    for (const v of [l.debit ?? 0, l.credit ?? 0]) {
      if (!Number.isInteger(v) || v < 0) throw new Error(`Ledger amounts must be non negative integers, got ${v}`);
    }
    if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw new Error('A ledger line is either a debit or a credit');
  }
  const d = out.reduce((a, l) => a + (l.debit ?? 0), 0);
  const c = out.reduce((a, l) => a + (l.credit ?? 0), 0);
  if (d !== c) throw new Error(`Unbalanced journal: debits ${d} vs credits ${c}`);
  if (out.length === 1) throw new Error('A journal needs at least two lines');
  return out;
}

/** Driver collects COD at the door: cash is with the driver, owed to the merchant after tonight's cycle. */
export function codCollected(o: OrderMoney, driverId?: string | null): Line[] {
  const ref = { orderId: o.id, merchantId: o.merchantId };
  return finalize([
    dr(ACC.CASH_WITH_DRIVERS, o.codAmount, { orderId: o.id, driverId: driverId ?? null, memo: `COD ${o.trackingNumber}` }),
    cr(ACC.COD_AWAITING_SETTLEMENT, o.codAmount, { ...ref, memo: `COD ${o.trackingNumber}` }),
  ]);
}

/**
 * Midnight cash cycle for a delivered order: COD moves into the merchant wallet,
 * and Shiply's frozen fees are taken from the wallet into revenue and VAT payable.
 */
export function deliveredSettlement(o: OrderMoney): Line[] {
  const ref = { orderId: o.id, merchantId: o.merchantId };
  return finalize([
    dr(ACC.COD_AWAITING_SETTLEMENT, o.codAmount, { ...ref, memo: 'COD collected' }),
    cr(ACC.MERCHANT_WALLETS, o.codAmount, { ...ref, memo: 'COD collected' }),
    dr(ACC.MERCHANT_WALLETS, o.totalFees, { ...ref, memo: 'Shiply fees' }),
    cr(ACC.REV_SHIPPING, o.shippingFee, { ...ref, memo: 'Shipping' }),
    cr(ACC.REV_COD_FEE, o.codFee, { ...ref, memo: 'COD fee' }),
    cr(ACC.REV_OPEN_PACKAGE, o.openPackageFee, { ...ref, memo: 'Open package fee' }),
    cr(ACC.VAT_PAYABLE, o.vatAmount, { ...ref, memo: 'VAT' }),
  ]);
}

/** VAT on the failed delivery charge uses the VAT setting frozen in the order's pricing snapshot. */
export function failedFeeAmounts(o: OrderMoney): { fee: number; vat: number } {
  const snap = (o.pricingSnapshot ?? {}) as { input?: { vatEnabled?: boolean }; config?: { vatRateBp?: number } };
  const vatEnabled = snap.input?.vatEnabled ?? false;
  const vatRateBp = snap.config?.vatRateBp ?? 0;
  const fee = o.failedDeliveryFee;
  return { fee, vat: vatEnabled ? applyBp(fee, vatRateBp) : 0 };
}

/** Returned or unsuccessful order: the merchant is charged the failed delivery fee (+ VAT). */
export function failedSettlement(o: OrderMoney): Line[] {
  const { fee, vat } = failedFeeAmounts(o);
  const ref = { orderId: o.id, merchantId: o.merchantId };
  return finalize([
    dr(ACC.MERCHANT_WALLETS, fee + vat, { ...ref, memo: 'Failed delivery charge' }),
    cr(ACC.REV_FAILED_DELIVERY, fee, { ...ref, memo: 'Failed delivery charge' }),
    cr(ACC.VAT_PAYABLE, vat, { ...ref, memo: 'VAT' }),
  ]);
}

export type CashoutMethod = 'BANK' | 'FAWRY_ACCOUNT' | 'FAWRY_CARD';

export interface CashoutFeeConfig {
  bankFlat: number;
  fawryAccountBp: number;
  fawryCardBp: number;
}

export function cashoutFee(method: CashoutMethod, amount: number, cfg: CashoutFeeConfig): number {
  if (method === 'BANK') return cfg.bankFlat;
  return applyBp(amount, method === 'FAWRY_ACCOUNT' ? cfg.fawryAccountBp : cfg.fawryCardBp);
}

/** Merchant cashout paid: wallet goes down by the gross amount, bank pays the net, Shiply keeps the fee. */
export function cashoutPaid(merchantId: string, amount: number, fee: number): Line[] {
  return finalize([
    dr(ACC.MERCHANT_WALLETS, amount, { merchantId, memo: 'Cashout' }),
    cr(ACC.BANK, amount - fee, { merchantId, memo: 'Cashout payment' }),
    cr(ACC.REV_CASHOUT_FEE, fee, { merchantId, memo: 'Cashout fee' }),
  ]);
}

export type DepositKind = 'DRIVER_TO_FAWRY' | 'DRIVER_TO_BANK' | 'FAWRY_SETTLEMENT' | 'HUB_TO_BANK' | 'HUB_TO_FAWRY';

/** Cash moving between drivers, Fawry and the bank. */
export function deposit(kind: DepositKind, amount: number, memo: string, driverId?: string | null): Line[] {
  switch (kind) {
    case 'DRIVER_TO_FAWRY':
      return finalize([dr(ACC.FAWRY_RECEIVABLE, amount, { memo }), cr(ACC.CASH_WITH_DRIVERS, amount, { memo, driverId: driverId ?? null })]);
    case 'DRIVER_TO_BANK':
      return finalize([dr(ACC.BANK, amount, { memo }), cr(ACC.CASH_WITH_DRIVERS, amount, { memo, driverId: driverId ?? null })]);
    case 'FAWRY_SETTLEMENT':
      return finalize([dr(ACC.BANK, amount, { memo }), cr(ACC.FAWRY_RECEIVABLE, amount, { memo })]);
    case 'HUB_TO_BANK':
      return finalize([dr(ACC.BANK, amount, { memo }), cr(ACC.CASH_IN_HUBS, amount, { memo })]);
    case 'HUB_TO_FAWRY':
      return finalize([dr(ACC.FAWRY_RECEIVABLE, amount, { memo }), cr(ACC.CASH_IN_HUBS, amount, { memo })]);
  }
}

/**
 * End of day handover: the driver's cash moves into the hub safe. A shortage stays on the driver
 * as a receivable (1050); an overage is booked as other income.
 */
export function driverHandover(driverId: string, expected: number, received: number, memo: string): Line[] {
  const short = Math.max(0, expected - received);
  const over = Math.max(0, received - expected);
  return finalize([
    dr(ACC.CASH_IN_HUBS, received, { memo }),
    dr(ACC.DRIVER_SHORTAGES, short, { driverId, memo: `Shortage: ${memo}` }),
    cr(ACC.CASH_WITH_DRIVERS, expected, { driverId, memo }),
    cr(ACC.REV_OTHER, over, { driverId, memo: `Overage: ${memo}` }),
  ]);
}

/** A driver pays back a recorded shortage into the hub safe. */
export function shortageRepaid(driverId: string, amount: number, memo: string): Line[] {
  return finalize([dr(ACC.CASH_IN_HUBS, amount, { memo }), cr(ACC.DRIVER_SHORTAGES, amount, { driverId, memo })]);
}

export type AdjustmentKind = 'COMPENSATION' | 'DEDUCTION';

/** Compensation credits the merchant wallet (expense); a deduction debits it (other income). */
export function merchantAdjustment(kind: AdjustmentKind, merchantId: string, amount: number, memo: string, orderId?: string | null): Line[] {
  const ref = { merchantId, orderId: orderId ?? null, memo };
  return kind === 'COMPENSATION'
    ? finalize([dr(ACC.EXP_COMPENSATION, amount, ref), cr(ACC.MERCHANT_WALLETS, amount, ref)])
    : finalize([dr(ACC.MERCHANT_WALLETS, amount, ref), cr(ACC.REV_OTHER, amount, ref)]);
}

/** A reversal mirrors every line of the original journal. */
export function reversal(lines: { accountCode: string; debit: number; credit: number; merchantId: string | null; orderId: string | null; driverId?: string | null; memo: string | null }[]): Line[] {
  return finalize(
    lines.map((l) => ({
      account: l.accountCode,
      debit: l.credit,
      credit: l.debit,
      merchantId: l.merchantId,
      orderId: l.orderId,
      driverId: l.driverId ?? null,
      memo: `Reversal: ${l.memo ?? ''}`.trim(),
    })),
  );
}
