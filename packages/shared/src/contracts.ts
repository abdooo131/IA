import { z } from 'zod';
import { isCalendarDay } from './hours';

// Cheques register, merchant contracts (volume tiers, monthly minimum, security deposit,
// credit limit) and the what if calculator of merchant profitability.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const piastres = z.number().int().min(1).max(1_000_000_000);
const day = z.string().refine(isCalendarDay, 'invalid_day');
const money = z.number().int().min(0).max(1_000_000_000);
const bp = z.number().int().min(0).max(10_000);

// ─── cheques ─────────────────────────────────────────────────────────────────────

export const CHEQUE_DIRECTIONS = ['received', 'issued'] as const;
export type ChequeDirectionName = (typeof CHEQUE_DIRECTIONS)[number];
/** What a received cheque pays: the merchant's balance, a security deposit, a supplier
 * paying back, other income. */
export const RECEIVED_PURPOSES = ['merchant', 'deposit', 'supplier', 'other_income'] as const;
/** What an issued cheque pays: a supplier bill, a merchant payout, a deposit paid back. */
export const ISSUED_PURPOSES = ['bill', 'payout', 'deposit_refund'] as const;
export const CHEQUE_PURPOSES = [...RECEIVED_PURPOSES, ...ISSUED_PURPOSES] as const;
export type ChequePurposeName = (typeof CHEQUE_PURPOSES)[number];
export const CHEQUE_STATUSES = [
  'awaiting_approval',
  'received',
  'issued',
  'deposited',
  'cleared',
  'bounced',
  'cancelled',
] as const;
export type ChequeStatusName = (typeof CHEQUE_STATUSES)[number];
/** Statuses of a cheque still waiting for its money (shown on the due list). */
export const CHEQUE_OPEN_STATUSES = ['received', 'deposited', 'issued'] as const;

/** Register number, for example CHQ-000012 */
export const chequeLabel = (n: number) => `CHQ-${String(n).padStart(6, '0')}`;

export const chequeSchema = z
  .object({
    direction: z.enum(CHEQUE_DIRECTIONS),
    purpose: z.enum(CHEQUE_PURPOSES),
    /** The number printed on the cheque */
    chequeNumber: z.string().trim().min(1).max(40),
    /** Received: the bank the cheque is drawn on (issued cheques take our bank's name) */
    bankName: z.string().trim().min(2).max(80).optional(),
    /** Who wrote it or who it is for; defaults to the merchant or supplier */
    partyName: z.string().trim().min(2).max(120).optional(),
    /** The cheque's amount; for a bill, how much of the bill it settles (withholding tax
     * included: the cheque is for that amount less the tax kept back) */
    amountPiastres: piastres.optional(),
    issueDate: day,
    dueDate: day,
    merchantId: id.optional(),
    supplierId: id.optional(),
    billId: id.optional(),
    payoutId: id.optional(),
    incomeAccountId: id.optional(),
    /** Issued: the bank the cheque is drawn on (ours) */
    bankAccountId: id.optional(),
    note: z.string().trim().max(300).optional(),
    receiptPhotoId: id.optional(),
    idempotencyKey: key,
  })
  .refine((v) => v.dueDate >= v.issueDate, { message: 'due_before_issue', path: ['dueDate'] })
  .refine(
    (v) =>
      v.direction === 'received'
        ? (RECEIVED_PURPOSES as readonly string[]).includes(v.purpose)
        : (ISSUED_PURPOSES as readonly string[]).includes(v.purpose),
    { message: 'purpose_direction', path: ['purpose'] },
  );
export type ChequeBody = z.infer<typeof chequeSchema>;

export const chequeDepositSchema = z.object({ bankAccountId: id.optional(), day: day.optional() });
export const chequeClearSchema = z.object({ bankAccountId: id.optional(), day: day.optional() });
export const chequeBounceSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  day: day.optional(),
});
export const chequeCancelSchema = z.object({ note: z.string().trim().min(3).max(300) });

// ─── merchant contracts ──────────────────────────────────────────────────────────

export interface ContractTier {
  /** From the nth delivered order of the Cairo month (1 is the first) */
  fromOrder: number;
  fixedFeePiastres: number | null;
  percentBp: number | null;
}

export const contractTierSchema = z
  .object({
    fromOrder: z.number().int().min(1).max(1_000_000),
    fixedFeePiastres: money.nullable(),
    percentBp: bp.nullable(),
  })
  .refine((t) => t.fixedFeePiastres !== null || t.percentBp !== null, {
    message: 'tier_empty',
  });

export const contractSchema = z
  .object({
    startDate: day,
    endDate: day.nullable(),
    noticeDays: z.number().int().min(0).max(3650),
    minimumMonthlyFeePiastres: money.nullable(),
    securityDepositPiastres: money.nullable(),
    creditLimitPiastres: money.nullable(),
    note: z.string().trim().max(500).nullable().optional(),
    tiers: z.array(contractTierSchema).max(20),
  })
  .refine((c) => c.endDate === null || c.endDate >= c.startDate, {
    message: 'end_before_start',
    path: ['endDate'],
  })
  .refine((c) => new Set(c.tiers.map((t) => t.fromOrder)).size === c.tiers.length, {
    message: 'tier_twice',
    path: ['tiers'],
  });
export type ContractBody = z.infer<typeof contractSchema>;

/**
 * The band an order falls in: the tier with the highest "from order" not above the order's
 * place in the month. Before the first band (or with no bands) there is none.
 */
export function tierFor<T extends { fromOrder: number }>(tiers: readonly T[], nth: number) {
  let best: T | null = null;
  for (const t of tiers)
    if (t.fromOrder <= nth && (!best || t.fromOrder > best.fromOrder)) best = t;
  return best;
}

/** A security deposit received (in) or paid back (out), by bank or through the wallet. */
export const depositSchema = z.object({
  direction: z.enum(['in', 'out']),
  /** bank: money moves through our bank; wallet: taken from or added to the merchant's balance */
  via: z.enum(['bank', 'wallet']),
  amountPiastres: piastres,
  bankAccountId: id.optional(),
  reference: z.string().trim().min(2).max(100),
  day: day.optional(),
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});
export type DepositBody = z.infer<typeof depositSchema>;

// ─── what if ────────────────────────────────────────────────────────────────────

/** A share in basis points of an amount, rounded half up, in whole piastres. */
export function bpShare(amount: number, basisPoints: number) {
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}

/** One merchant's month, as the what if calculator needs it. */
export interface WhatIfBase {
  deliveredOrders: number;
  /** Products value of the delivered orders */
  productsPiastres: number;
  /** Cash collected on them */
  codCashPiastres: number;
  /** Fees booked in the month by kind (before VAT), the minimum top up included */
  feesByKind: Record<string, number>;
  /** Every cost counted for the merchant in the month */
  costsPiastres: number;
}

export interface WhatIfParams {
  orderFixedPiastres: number;
  orderPercentBp: number;
  codPercentBp: number;
  /** null: no monthly minimum */
  minimumPiastres: number | null;
}

/** Fees that change with the what if values; every other fee stays as it was booked. */
const VARIABLE_FEES = new Set(['order_fee', 'cod_fee', 'minimum_fee']);

/**
 * The same month again with other fee values: order and COD fees are worked out afresh on
 * the month's orders, products value and cash, the other fees stay, and the minimum tops the
 * total up. Costs do not change.
 */
export function whatIf(base: WhatIfBase, p: WhatIfParams) {
  const orderFee =
    base.deliveredOrders * p.orderFixedPiastres + bpShare(base.productsPiastres, p.orderPercentBp);
  const codFee = bpShare(base.codCashPiastres, p.codPercentBp);
  const otherFees = Object.entries(base.feesByKind)
    .filter(([kind]) => !VARIABLE_FEES.has(kind))
    .reduce((s, [, v]) => s + v, 0);
  const beforeMinimum = orderFee + codFee + otherFees;
  const minimumTopUp = p.minimumPiastres ? Math.max(0, p.minimumPiastres - beforeMinimum) : 0;
  const fees = beforeMinimum + minimumTopUp;
  const margin = fees - base.costsPiastres;
  return {
    orderFeePiastres: orderFee,
    codFeePiastres: codFee,
    otherFeesPiastres: otherFees,
    minimumTopUpPiastres: minimumTopUp,
    feesPiastres: fees,
    marginPiastres: margin,
    marginPerOrderPiastres:
      base.deliveredOrders > 0 ? Math.round(margin / base.deliveredOrders) : null,
  };
}
