import {
  type CommissionStatus,
  type ContractTier,
  type CrmStage,
  type ProposalFee,
  type ProposalFees,
  type ProposalStatus,
  PROPOSAL_FEE_KEYS,
  shiftMonth,
} from '@shiplynow/shared';
import { parseEgp } from './money';

// Sales CRM part 2 screens (docs/SALES.md): proposals, the dashboard, targets and commission.
// What the API answers, and the small rules the forms share.

export interface ProposalView {
  id: string;
  number: number;
  label: string;
  dealId: string;
  version: number;
  status: ProposalStatus;
  fees: ProposalFees;
  expectedMonthlyOrders: number | null;
  averageOrderPiastres: number | null;
  minimumMonthlyFeePiastres: number | null;
  securityDepositPiastres: number | null;
  creditLimitPiastres: number | null;
  contractStartDate: string | null;
  contractMonths: number | null;
  noticeDays: number;
  terms: string | null;
  tiers: ContractTier[];
  maxDiscountBp: number;
  needsApproval: boolean;
  approvalRequestedAt: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  token: string | null;
  sentAt: string | null;
  sentBy: { id: string; name: string } | null;
  validUntil: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  declineReason: string | null;
  confirmedAt: string | null;
  confirmedBy: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  example: ExampleMonth;
}

export interface ExampleMonth {
  orders: number;
  orderFeesPiastres: number;
  codFeesPiastres: number;
  minimumTopUpPiastres: number;
  totalPiastres: number;
  perOrderPiastres: number | null;
}

export interface DealProposals {
  proposals: ProposalView[];
  defaults: ProposalFees;
  maxDiscountBp: number;
  validDays: number;
  merchantOwner: { id: string; name: string; email: string; isActive: boolean } | null;
}

export interface ProposalRow extends ProposalView {
  deal: {
    id: string;
    number: number;
    label: string;
    stage: CrmStage;
    owner: { id: string; name: string } | null;
    company: { id: string; brandName: string };
  };
}

export interface PublicProposal {
  label: string;
  version: number;
  status: ProposalStatus;
  brand: string;
  company: {
    legalNameEn: string;
    legalNameAr: string;
    taxRegistrationNumber: string | null;
    address: string;
  };
  rep: { name: string; email: string; phone: string | null } | null;
  fees: ProposalFees;
  tiers: ContractTier[];
  expectedMonthlyOrders: number | null;
  averageOrderPiastres: number | null;
  minimumMonthlyFeePiastres: number | null;
  securityDepositPiastres: number | null;
  creditLimitPiastres: number | null;
  contractStartDate: string | null;
  contractMonths: number | null;
  noticeDays: number;
  terms: string | null;
  vatBp: number;
  sentAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  example: ExampleMonth;
}

/** Fees kept as pounds (fixed amounts) or percent (shares), as the form shows them. */
export const PERCENT_FEES: ProposalFee[] = ['orderPercentBp', 'codPercentBp'];
export const isPercentFee = (k: ProposalFee) => PERCENT_FEES.includes(k);

/** Basis points as a percent text: 150 → "1.5", 2000 → "20". */
export function bpText(bp: number) {
  const whole = Math.trunc(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * A percent typed by the rep as basis points, without floats: "1.5" → 150, "20" → 2000.
 * At most two decimals and never above 100%; anything else is null.
 */
export function parsePercentBp(text: string): number | null {
  const t = text.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Piastres as the form's pound text: 150050 → "1500.50". */
export function egpInput(piastres: number | null) {
  return piastres === null ? '' : (piastres / 100).toFixed(2);
}

/** A whole count typed in a form, or null when empty; NaN when not a whole number. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d{1,9}$/.test(t) ? Number(t) : Number.NaN;
}

/** A money field: null when empty, NaN when it is not money. */
export function parseMoney(text: string): number | null {
  if (text.trim() === '') return null;
  return parseEgp(text) ?? Number.NaN;
}

export interface TierInput {
  fromOrder: string;
  fixed: string;
  percent: string;
}

/** The tiers typed in the form, checked: each needs its first order and a fee. */
export function parseTiers(rows: TierInput[]): ContractTier[] | null {
  const out: ContractTier[] = [];
  for (const r of rows) {
    if (!r.fromOrder.trim() && !r.fixed.trim() && !r.percent.trim()) continue;
    const from = parseCount(r.fromOrder);
    const fixed = r.fixed.trim() ? parseEgp(r.fixed) : null;
    const percent = r.percent.trim() ? parsePercentBp(r.percent) : null;
    if (from === null || Number.isNaN(from) || from < 1) return null;
    if (r.fixed.trim() && fixed === null) return null;
    if (r.percent.trim() && percent === null) return null;
    if (fixed === null && percent === null) return null;
    out.push({ fromOrder: from, fixedFeePiastres: fixed, percentBp: percent });
  }
  if (new Set(out.map((t) => t.fromOrder)).size !== out.length) return null;
  return out.sort((a, b) => a.fromOrder - b.fromOrder);
}

/** The tiers back as form rows. */
export function tierRows(tiers: ContractTier[]): TierInput[] {
  return tiers.map((t) => ({
    fromOrder: String(t.fromOrder),
    fixed: egpInput(t.fixedFeePiastres),
    percent: t.percentBp === null ? '' : bpText(t.percentBp),
  }));
}

/** The fee field as the form shows it. */
export function feeInput(k: ProposalFee, value: number) {
  return isPercentFee(k) ? bpText(value) : egpInput(value);
}

/** A fee field typed by the rep, as the API takes it (null when not valid). */
export function parseFee(k: ProposalFee, text: string): number | null {
  return isPercentFee(k) ? parsePercentBp(text) : parseEgp(text);
}

export { PROPOSAL_FEE_KEYS };

/** The public link of a sent proposal on this site. */
export function proposalLink(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/p/${token}`;
}

/** The address of a new owner's one time setup link. */
export function setupLink(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/setup/${token}`;
}

/** What the rep can do with a proposal now. */
export function proposalActions(
  p: Pick<
    ProposalView,
    'status' | 'needsApproval' | 'approvedAt' | 'approvalRequestedAt' | 'confirmedAt' | 'createdBy'
  >,
  me: { id: string; canEdit: boolean; canManage: boolean },
) {
  const draft = p.status === 'draft';
  const waiting = draft && p.needsApproval && !p.approvedAt;
  return {
    edit: me.canEdit && draft,
    requestApproval: me.canEdit && waiting && !p.approvalRequestedAt,
    approve: me.canManage && waiting && p.createdBy.id !== me.id,
    send: me.canEdit && draft && !waiting,
    copyLink: p.status === 'sent' || p.status === 'viewed',
    confirm: me.canEdit && p.status === 'accepted' && !p.confirmedAt,
  };
}

// ─── dashboard, targets, commission ─────────────────────────────────────────────

export interface RepFigures {
  dealsWon: number;
  orders: number;
  feeRevenuePiastres: number;
}

export interface TargetRow {
  user: { id: string; name: string; manager: boolean };
  target: (RepFigures & { updatedAt: string; updatedBy: string }) | null;
  actual: RepFigures;
  progress: { dealsWon: number | null; orders: number | null; feeRevenue: number | null };
}

export interface SalesDashboard {
  month: string;
  ownerId: string | null;
  funnel: { stage: CrmStage; count: number; toNextBp: number | null }[];
  pipeline: { stage: CrmStage; count: number; valuePiastres: number }[];
  pipelineValuePiastres: number;
  openDeals: number;
  newLeads: number;
  leadsBySource: { source: string; count: number }[];
  won: number;
  lost: number;
  winRateBp: number | null;
  avgDaysToClose: number | null;
  lostReasons: { code: string; label: { en: string; ar: string } | null; count: number }[];
  overdueFollowUps: number;
  wonByMonth: { month: string; count: number }[];
  leaderboard: TargetRow[];
}

export interface CommissionLine {
  dealId: string;
  label: string;
  company: string;
  monthIndex: number;
  feesPiastres: number;
  rateBp: number;
  amountPiastres: number;
}

export interface CommissionRow {
  id: string;
  month: string;
  status: CommissionStatus;
  user: { id: string; name: string };
  computedPiastres: number;
  amountPiastres: number;
  adjustReason: string | null;
  adjustedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  paidVia: 'payroll' | 'bonus' | null;
  paidAt: string | null;
  paidEntry: number | null;
  lines: CommissionLine[];
}

export interface Commissions {
  month: string;
  estimate: {
    user: { id: string; name: string };
    amountPiastres: number;
    lines: CommissionLine[];
  }[];
  commissions: CommissionRow[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The month a page shows: the one asked for when it is a month, else the current one. */
export function pickMonth(asked: string | undefined, current: string) {
  return asked && MONTH.test(asked) ? asked : current;
}

/** The month before and after, for the month switch. */
export function monthNeighbours(month: string) {
  return { previous: shiftMonth(month, -1), next: shiftMonth(month, 1) };
}

/** Progress in basis points as a whole percent for a bar (capped at 100 for the width). */
export function progressWidth(bp: number | null) {
  if (bp === null) return 0;
  return Math.max(0, Math.min(100, Math.round(bp / 100)));
}

/** A share of a total for a bar width in percent. */
export function shareWidth(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}
