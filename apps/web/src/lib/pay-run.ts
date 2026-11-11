// The guided Pay merchants run's steps and data (GET /finance/payouts/run), shared by the
// server page and the client component.

export const PAY_STEPS = ['prepare', 'review', 'approve', 'file', 'pay', 'done'] as const;
export type PayStep = (typeof PAY_STEPS)[number];

export interface PayRunData {
  today: string;
  cutoffDay: string;
  limitPiastres: number;
  current: PayStep;
  done: Record<PayStep, boolean>;
  dueCount: number;
  due: {
    merchantId: string;
    name: string;
    schedule: string;
    owedPiastres: number;
    minimumPiastres: number;
    bankDetails: boolean;
    draftId: string | null;
    state: 'drafted' | 'paid_today' | 'ready' | 'below_minimum' | 'nothing_owed';
  }[];
  drafts: {
    id: string;
    number: string;
    merchantId: string;
    merchant: string;
    amountPiastres: number;
    cutoffDay: string;
    bankDetails: boolean;
    needsApproval: boolean;
    approved: boolean;
    approvedBy: string | null;
    createdBy: string;
    mine: boolean;
    ready: boolean;
    soa: { number: string; netPiastres: number } | null;
    proof: { number: string; amountPiastres: number; reference: string } | null;
    checksDone: number;
    checksTotal: number;
    viewedByMe: boolean;
  }[];
  paid: {
    id: string;
    number: string;
    merchant: string;
    amountPiastres: number;
    reference: string | null;
    paidAt: string;
    emails: number;
  }[];
  totals: {
    draftsPiastres: number;
    readyPiastres: number;
    readyCount: number;
    toApprove: number;
    missingBank: number;
    paidPiastres: number;
    emailsQueued: number;
  };
}
