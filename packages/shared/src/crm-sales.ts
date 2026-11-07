import { z } from 'zod';
import {
  bpShare,
  CONTRACT_PRICE_KEYS,
  CONTRACT_PRICES,
  type ContractPriceKey,
  contractTierSchema,
  type ContractTier,
  resolvePrices,
  tierFor,
  tierValue,
} from './contracts';
import { PAYOUT_SCHEDULES } from './finance';
import { shiftMonth } from './cash-control';
import { addDays, isCalendarDay } from './hours';

// Sales CRM part 2 (docs/SALES.md): proposals sent to a brand as a link they accept online,
// monthly targets per rep, the sales dashboard and commission on the fees of won merchants.

// ─── proposals ───────────────────────────────────────────────────────────────────

export const PROPOSAL_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'superseded',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
/** A proposal the brand can still answer through its link. */
export const PROPOSAL_OPEN_STATUSES = ['sent', 'viewed'] as const;

/** Proposal numbers are shown as PRO-000001 (gapless, like other documents). */
export function proposalNumber(n: number) {
  return `PRO-${String(n).padStart(6, '0')}`;
}

/** The fees a proposal offers, each with the fee setting it starts from (the contract's prices). */
export const PROPOSAL_FEES = Object.fromEntries(
  CONTRACT_PRICE_KEYS.map((k) => [k, CONTRACT_PRICES[k].setting]),
) as { [K in ContractPriceKey]: (typeof CONTRACT_PRICES)[K]['setting'] };
export type ProposalFee = ContractPriceKey;
export const PROPOSAL_FEE_KEYS: ProposalFee[] = [...CONTRACT_PRICE_KEYS];
export type ProposalFees = Record<ProposalFee, number>;

const money = z.number().int().min(0).max(1_000_000_000);
const bp = z.number().int().min(0).max(10_000);
const day = z.string().refine(isCalendarDay, 'invalid_day');
const id = z.string().min(1).max(64);
const idempotencyKey = z.string().min(8).max(100);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const proposalFields = {
  orderFixedPiastres: money,
  orderPercentBp: bp,
  codPercentBp: bp,
  failedDeliveryPiastres: money,
  receivingPerUnitPiastres: money,
  storagePerUnitMonthPiastres: money,
  returnPerUnitPiastres: money,
  expectedMonthlyOrders: z.number().int().min(0).max(10_000_000).nullable(),
  averageOrderPiastres: money.nullable(),
  minimumMonthlyFeePiastres: money.nullable(),
  securityDepositPiastres: money.nullable(),
  creditLimitPiastres: money.nullable(),
  contractStartDate: day.nullable(),
  contractMonths: z.number().int().min(1).max(120).nullable(),
  noticeDays: z.number().int().min(0).max(3650),
  terms: text(4000),
  tiers: z.array(contractTierSchema).max(20),
  /** Payment terms and promises, carried into the contract as they are */
  payoutSchedule: z.enum(PAYOUT_SCHEDULES).nullable(),
  minimumPayoutPiastres: money.nullable(),
  promiseMinutes: z.number().int().min(10).max(1440).nullable(),
  deliveryAttempts: z.number().int().min(1).max(10).nullable(),
};
const tiersOnce = (v: { tiers?: { fromOrder: number }[] }) =>
  !v.tiers || new Set(v.tiers.map((t) => t.fromOrder)).size === v.tiers.length;

/**
 * A new proposal for a deal. Every value left out starts from the fee settings (fees), the
 * deal (orders a month) or nothing (terms).
 */
export const proposalCreateSchema = z
  .object(proposalFields)
  .partial()
  .extend({ dealId: id, idempotencyKey })
  .refine(tiersOnce, { message: 'tier_twice', path: ['tiers'] });
export type ProposalCreateBody = z.infer<typeof proposalCreateSchema>;

export const proposalUpdateSchema = z
  .object(proposalFields)
  .partial()
  .refine(tiersOnce, { message: 'tier_twice', path: ['tiers'] })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing_to_change');
export type ProposalUpdateBody = z.infer<typeof proposalUpdateSchema>;

/** The brand accepts on the public page: who signs and their title. */
export const proposalAcceptSchema = z.object({
  signerName: z.string().trim().min(2, 'name_required').max(120),
  signerTitle: z.string().trim().min(2, 'title_required').max(120),
});
export type ProposalAcceptBody = z.infer<typeof proposalAcceptSchema>;

export const proposalDeclineSchema = z.object({
  signerName: z.string().trim().min(2, 'name_required').max(120),
  reason: text(1000),
});
export type ProposalDeclineBody = z.infer<typeof proposalDeclineSchema>;

/**
 * The rep confirms an accepted proposal: the merchant's owner login (name, email, mobile).
 * When the company already is a merchant (a sign up), its users stay and these are not needed.
 */
export const proposalConfirmSchema = z.object({
  ownerName: z.string().trim().min(2, 'name_required').max(120).optional(),
  ownerEmail: z.string().trim().toLowerCase().email('invalid_email').max(200).optional(),
  ownerPhone: z.string().trim().max(40).nullable().optional(),
  merchantName: z.string().trim().min(2).max(120).optional(),
});
export type ProposalConfirmBody = z.infer<typeof proposalConfirmSchema>;

/** The largest discount allowed without a sales manager, against each fee setting. */
export function discountBp(value: number, list: number): number {
  if (list <= 0 || value >= list) return 0;
  return Math.floor(((list - value) * 10_000) / list);
}

/**
 * Every discount a proposal gives against the fee settings, tiers included (a tier's fixed fee
 * against the order fixed fee, its percent against the order percent).
 */
export function proposalDiscounts(
  p: ProposalFees & { tiers: readonly ContractTier[] },
  list: ProposalFees,
): { field: string; discountBp: number }[] {
  const out: { field: string; discountBp: number }[] = PROPOSAL_FEE_KEYS.map((k) => ({
    field: k,
    discountBp: discountBp(p[k], list[k]),
  }));
  for (const t of p.tiers)
    for (const k of PROPOSAL_FEE_KEYS) {
      const value = tierValue(t, k);
      if (value !== null)
        out.push({ field: `tier${t.fromOrder}.${k}`, discountBp: discountBp(value, list[k]) });
    }
  return out;
}

/** The largest discount of a proposal, and whether it needs a sales manager first. */
export function proposalApproval(
  p: ProposalFees & { tiers: readonly ContractTier[] },
  list: ProposalFees,
  maxDiscountBp: number,
) {
  const max = Math.max(0, ...proposalDiscounts(p, list).map((d) => d.discountBp));
  return { maxDiscountBp: max, needsApproval: max > maxDiscountBp };
}

/**
 * The example month on the proposal page: the expected orders at the average order value,
 * every order paid cash on delivery, the volume tiers applied order by order (the order that
 * crosses into a band and every later one pay the band's fee), topped up to the minimum.
 * Before VAT. Without an average order value the percent parts count as zero.
 */
export function exampleMonth(
  p: ProposalFees & {
    expectedMonthlyOrders: number | null;
    averageOrderPiastres: number | null;
    minimumMonthlyFeePiastres: number | null;
    tiers: readonly ContractTier[];
  },
) {
  const orders = p.expectedMonthlyOrders ?? 0;
  const average = p.averageOrderPiastres ?? 0;
  // The fees change only where a band starts: walk the bands, not every order.
  const starts = [1, ...p.tiers.map((t) => t.fromOrder).filter((n) => n > 1 && n <= orders)].sort(
    (a, b) => a - b,
  );
  let orderFees = 0;
  let codFees = 0;
  for (const [i, from] of starts.entries()) {
    const to = i + 1 < starts.length ? starts[i + 1]! - 1 : orders;
    const count = Math.max(0, to - from + 1);
    const prices = resolvePrices(null, tierFor(p.tiers, from), p);
    orderFees += count * (prices.orderFixedPiastres + bpShare(average, prices.orderPercentBp));
    codFees += count * bpShare(average, prices.codPercentBp);
  }
  const beforeMinimum = orderFees + codFees;
  const minimumTopUp = p.minimumMonthlyFeePiastres
    ? Math.max(0, p.minimumMonthlyFeePiastres - beforeMinimum)
    : 0;
  const total = beforeMinimum + minimumTopUp;
  return {
    orders,
    orderFeesPiastres: orderFees,
    codFeesPiastres: codFees,
    minimumTopUpPiastres: minimumTopUp,
    totalPiastres: total,
    perOrderPiastres: orders > 0 ? Math.round(total / orders) : null,
  };
}

/** The last day of a contract that starts on a day and runs n months (null: open ended). */
export function contractEndDay(start: string, months: number | null): string | null {
  if (!months) return null;
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const target = shiftMonth(`${y}-${String(m).padStart(2, '0')}`, months);
  const [ty, tm] = target.split('-').map(Number) as [number, number];
  // The same day of the month n months later (or that month's last day), less one day.
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const same = `${target}-${String(Math.min(d, last)).padStart(2, '0')}`;
  return addDays(same, -1);
}

// ─── targets, dashboard, commission ─────────────────────────────────────────────

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month');

export const targetSchema = z.object({
  userId: id,
  month: monthSchema,
  dealsWon: z.number().int().min(0).max(10_000),
  orders: z.number().int().min(0).max(100_000_000),
  feeRevenuePiastres: money,
});
export type TargetBody = z.infer<typeof targetSchema>;

/** closed: nothing to pay (target missed, no target set, or nothing earned), no approval. */
export const COMMISSION_STATUSES = ['draft', 'approved', 'paid', 'closed'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** A rep's month against their fees target. */
export const COMMISSION_OUTCOMES = ['hit', 'missed', 'no_target'] as const;
export type CommissionOutcome = (typeof COMMISSION_OUTCOMES)[number];

/**
 * Hit or miss: the counted fees at or above a fees target above 0 hit it; a target of 0 or none
 * at all is no target; anything else missed it.
 */
export function commissionOutcome(
  revenuePiastres: number,
  targetPiastres: number | null | undefined,
): CommissionOutcome {
  if (!targetPiastres || targetPiastres <= 0) return 'no_target';
  return revenuePiastres >= targetPiastres ? 'hit' : 'missed';
}

/** How much more counted fees the rep needs to hit the target (0 once hit, null without one). */
export function targetGap(revenuePiastres: number, targetPiastres: number | null | undefined) {
  if (!targetPiastres || targetPiastres <= 0) return null;
  return Math.max(0, targetPiastres - revenuePiastres);
}

/**
 * The month a won merchant qualifies in: the nth distinct Cairo month (n = the qualifying
 * months frozen on the deal) in which it had a delivered order since the win; null before.
 */
export function qualifyingMonth(activeMonths: readonly string[], needed: number): string | null {
  const months = [...new Set(activeMonths)].sort();
  return months[Math.max(1, needed) - 1] ?? null;
}

/** A sales manager changes a draft commission: the amount to pay and why. */
export const commissionAdjustSchema = z.object({
  amountPiastres: money,
  reason: z.string().trim().min(3, 'reason_required').max(500),
});
export type CommissionAdjustBody = z.infer<typeof commissionAdjustSchema>;

/**
 * Which commission month of a won deal a month is: 1 is the month it was won, up to the
 * deal's number of months (0: no end); null outside.
 */
export function commissionMonthIndex(wonMonth: string, month: string, months: number) {
  const [wy, wm] = wonMonth.split('-').map(Number) as [number, number];
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = (y - wy) * 12 + (m - wm) + 1;
  return index >= 1 && (months <= 0 || index <= months) ? index : null;
}

/** Commission on a month's fees: the share in basis points, never below zero. */
export function commissionOn(feesPiastres: number, rateBp: number) {
  return bpShare(Math.max(0, feesPiastres), rateBp);
}

/**
 * The funnel: how many deals reached each stage of the path (a deal that skipped a stage
 * still passed it) and the share that went on from each stage to the next, in basis points.
 */
export function funnel(stages: readonly string[], reached: Record<string, number>) {
  return stages.map((stage, i) => {
    const count = reached[stage] ?? 0;
    const next = stages[i + 1];
    return {
      stage,
      count,
      toNextBp:
        next === undefined
          ? null
          : count > 0
            ? Math.round(((reached[next] ?? 0) * 10_000) / count)
            : null,
    };
  });
}

/** Progress against a target in basis points (null without a target). */
export function progressBp(value: number, target: number | null | undefined) {
  if (!target) return null;
  return Math.round((value * 10_000) / target);
}
