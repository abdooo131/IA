import { z } from 'zod';

// Payslips in My HR and employee expense claims. A payslip is one person's line of a posted
// salary run (packages/db/src/finance/payroll.ts); an expense claim (EC-000001) is a work cost
// a person paid from their own pocket: their manager in force approves it, accounting pays it
// back from a bank or cash box.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const expenseClaimNumber = (n: number) => `EC-${String(n).padStart(6, '0')}`;

export const EXPENSE_CLAIM_STATUSES = [
  'pending_manager',
  'pending_accounting',
  'paid',
  'rejected',
  'cancelled',
] as const;
export type ExpenseClaimStatus = (typeof EXPENSE_CLAIM_STATUSES)[number];

/** A claim a person may still take back: nobody has approved it yet. */
export function claimCancellable(c: {
  status: ExpenseClaimStatus;
  managerDecidedAt: Date | string | null;
}) {
  return (
    c.status === 'pending_manager' || (c.status === 'pending_accounting' && !c.managerDecidedAt)
  );
}

/** A person claims a work cost back from My HR. */
export const expenseClaimSchema = z.object({
  amountPiastres: z.number().int().min(1).max(100_000_000),
  expenseAccountId: id,
  /** The store the cost belongs to; null is a company wide cost */
  darkStoreId: id.nullable(),
  /** The Cairo day the person paid (never in the future, never older than claims.max_age_days) */
  paidOn: day,
  note: z.string().trim().min(3).max(500),
  photoId: id,
  idempotencyKey: key,
});
export type ExpenseClaimBody = z.infer<typeof expenseClaimSchema>;

export const claimRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/** Accounting pays an approved claim from a bank or cash box. */
export const claimPaySchema = z.object({
  moneyAccountId: id,
  reference: z.string().trim().max(120).optional(),
});

/** Finance marks which expense categories employees may claim. */
export const claimableCategorySchema = z.object({ claimable: z.boolean() });

/** One line of a person's payslip, as the run stored it. */
export interface MyPayslipLine {
  kind: string;
  label: string;
  days: number | null;
  amountPiastres: number;
}
