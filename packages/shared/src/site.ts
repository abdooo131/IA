import { z } from 'zod';

// The public website (apps/web "/"): the contact form sends a lead, which opens a company and a
// deal in the Sales CRM (docs/SALES.md), followed up at /admin/sales/leads.

/** Orders a month in Cairo, as the visitor picks it on the form. */
export const ORDERS_BANDS = ['under_300', '300_1000', '1000_5000', 'over_5000'] as const;
export type OrdersBand = (typeof ORDERS_BANDS)[number];

/**
 * The contact form. The mobile is not refused when it is not a valid Egyptian mobile: the
 * lead keeps what was typed and is flagged (phone_valid false), so sales can still call.
 */
export const siteLeadSchema = z.object({
  name: z.string().trim().min(2, 'name_required').max(120, 'name_too_long'),
  phone: z
    .string()
    .trim()
    .min(1, 'phone_required')
    .max(40, 'phone_too_long')
    .refine((v) => (v.match(/[0-9٠-٩]/g) ?? []).length >= 6, 'phone_short'),
  website: z
    .string()
    .trim()
    .max(200, 'website_too_long')
    .optional()
    .transform((v) => (v ? v : null)),
  ordersBand: z.enum(ORDERS_BANDS, { message: 'orders_band_required' }),
  locale: z.enum(['en', 'ar']).default('en'),
  idempotencyKey: z.string().min(8).max(100),
});
export type SiteLeadBody = z.infer<typeof siteLeadSchema>;
export type SiteLeadInput = z.input<typeof siteLeadSchema>;

/** Arabic-Indic digits (as an Arabic keyboard types them) turned into 0-9. */
export function latinDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * The field each form problem belongs to, so the page shows it next to that field.
 * Returns field → message code (the zod message).
 */
export function siteLeadFieldErrors(input: unknown): Record<string, string> | null {
  const parsed = siteLeadSchema.safeParse(input);
  if (parsed.success) return null;
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    if (!errors[field]) errors[field] = issue.message;
  }
  return errors;
}
