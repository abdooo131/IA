import { z } from 'zod';

// "Coming up and due" on the Accounting dashboard and /finance/due: the kinds of payment the
// company already knows it will make, and the groups they are shown in.

export const PAYMENT_DUE_KINDS = [
  'recurring',
  'bill',
  'loan',
  'salaries',
  'tax',
  'postal',
  'payout',
] as const;
export type PaymentDueKind = (typeof PAYMENT_DUE_KINDS)[number];

/** overdue: before today; week: today to 7 days ahead; month: up to 30 days; later: past 30. */
export const PAYMENT_DUE_GROUPS = ['overdue', 'week', 'month', 'later'] as const;
export type PaymentDueGroup = (typeof PAYMENT_DUE_GROUPS)[number];

/** The longest window the full page shows (days ahead of today). */
export const PAYMENT_DUE_MAX_DAYS = 90;

/** Query of GET /finance/payments-due: days ahead (default 30) and kinds (comma separated). */
export const paymentsDueQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(PAYMENT_DUE_MAX_DAYS).default(30),
  kinds: z
    .string()
    .max(200)
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter((k): k is PaymentDueKind => (PAYMENT_DUE_KINDS as readonly string[]).includes(k)),
    ),
});
export type PaymentsDueQuery = z.infer<typeof paymentsDueQuerySchema>;
