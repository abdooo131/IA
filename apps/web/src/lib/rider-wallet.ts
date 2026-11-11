import type { WalletTotals, WithdrawalDetails, WithdrawalStatus } from '@shiplynow/shared';

// Rider pay (CLAUDE.md "Rider pay"): what the rider wallet and Accounting's withdrawals page
// read from the API, and the small sums the screens show.

export interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export interface WithdrawalView {
  id: string;
  number: string;
  status: WithdrawalStatus;
  amountPiastres: number;
  deductionPiastres: number;
  deductions: { duesPiastres: number; advancePiastres: number };
  grossPiastres: number;
  method: WithdrawalDetails['method'];
  details: WithdrawalDetails;
  rider: { id: string; badgeCode: string; name: string };
  darkStore: StoreRef;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  paidAt: string | null;
  paidBy: { id: string; name: string } | null;
  paidFrom: { code: string; name: string } | null;
  reference: string | null;
  entryNumber: number | null;
  rejectedAt: string | null;
  rejectedBy: { id: string; name: string } | null;
  rejectReason: string | null;
  cancelledAt: string | null;
}

export interface WalletEarningView {
  lineId: string;
  orderId: string | null;
  orderNumber: string | null;
  at: string;
  day: string;
  amountPiastres: number;
  availableOn: string;
  available: boolean;
  darkStore: StoreRef | null;
}

export interface RiderWalletView {
  rider: { id: string; name: string; badgeCode: string; darkStore: StoreRef };
  today: string;
  totals: WalletTotals;
  owed: {
    duesPiastres: number;
    advancePiastres: number;
    totalPiastres: number;
    outstandingPiastres: number;
    charges: { kind: string; memo: string | null; at: string; amountPiastres: number }[];
  };
  rules: {
    holdDays: number;
    weekend: number[];
    minPiastres: number;
    maxOpen: number;
    perDeliveryPiastres: number;
  };
  earnings: WalletEarningView[];
  withdrawals: WithdrawalView[];
  lastDetails: WithdrawalDetails | null;
  canRequest: 'withdrawal_already_open' | 'nothing_available' | null;
}

export interface RiderWalletRow {
  id: string;
  name: string;
  isActive: boolean;
  badgeCode: string;
  darkStore: StoreRef;
  cashPiastres: number;
  /** Basata deposits: frozen for cash not handed in by the deadline */
  frozen: boolean;
  wallet: WalletTotals;
}

export interface WithdrawalList {
  withdrawals: WithdrawalView[];
  counts: { requested: number; approved: number; openPiastres: number };
}

/**
 * What a withdrawal of `amount` looks like to the rider: what they receive, what is taken for
 * what they owe (set aside on the request, cleared when it is paid) and what leaves the wallet.
 */
export function withdrawalPreview(amountPiastres: number, owed: RiderWalletView['owed']) {
  const deducted = Math.max(0, owed.outstandingPiastres);
  return {
    receivePiastres: amountPiastres,
    deductedPiastres: deducted,
    fromWalletPiastres: amountPiastres + deducted,
  };
}

/** Whether `amount` may be asked for: within what is available and above the minimum (unless
 * it is everything available). Answers the error code the API would give. */
export function withdrawalProblem(
  amountPiastres: number | null,
  wallet: Pick<RiderWalletView, 'totals' | 'rules'>,
): 'invalid_amount' | 'more_than_available' | 'below_minimum' | null {
  if (amountPiastres === null || amountPiastres <= 0) return 'invalid_amount';
  if (amountPiastres > wallet.totals.availablePiastres) return 'more_than_available';
  if (
    amountPiastres < wallet.rules.minPiastres &&
    amountPiastres !== wallet.totals.availablePiastres
  )
    return 'below_minimum';
  return null;
}

/** One line for where the money goes, without the words (the screen adds them). */
export function detailsText(d: WithdrawalDetails): string {
  switch (d.method) {
    case 'store_cash':
      return '';
    case 'instapay':
      return d.handle;
    case 'mobile_wallet':
      return d.phone;
    case 'bank':
      return `${d.bankName} · ${d.iban} · ${d.holder}`;
  }
}
