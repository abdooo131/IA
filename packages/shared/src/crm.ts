import { z } from 'zod';
import type { OrdersBand } from './site';

// Sales CRM (docs/SALES.md). Companies are the brands we sell to, contacts the people there,
// deals the sales opportunities that walk the pipeline and activities what the rep did or
// will do next (calls, meetings, messages, tasks).

export const CRM_SOURCES = [
  'website_form',
  'signup',
  'manual',
  'referral',
  'event',
  'other',
] as const;
export type CrmSource = (typeof CRM_SOURCES)[number];
/** The sources a rep may pick by hand (the website form and sign ups come in by themselves). */
export const CRM_MANUAL_SOURCES = ['manual', 'referral', 'event', 'other'] as const;

/** The pipeline, in order. won and lost close a deal. */
export const CRM_STAGES = [
  'new',
  'contacted',
  'meeting',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];
export const CRM_OPEN_STAGES = ['new', 'contacted', 'meeting', 'proposal', 'negotiation'] as const;
export const CRM_CLOSED_STAGES = ['won', 'lost'] as const;
export function isOpenStage(stage: string): boolean {
  return (CRM_OPEN_STAGES as readonly string[]).includes(stage);
}

export const CRM_ACTIVITY_TYPES = ['call', 'meeting', 'whatsapp', 'email', 'note', 'task'] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

/** A lost deal without a listed reason names "other" and explains it in the note. */
export const LOST_REASON_OTHER = 'other';

/** The lost reasons a fresh database starts with; sales managers edit the list. */
export const DEFAULT_LOST_REASONS = [
  { code: 'price', labelEn: 'Price too high', labelAr: 'السعر مرتفع' },
  { code: 'no_shopify', labelEn: 'Not on Shopify', labelAr: 'لا يستخدم Shopify' },
  { code: 'low_volume', labelEn: 'Too few orders', labelAr: 'طلبات قليلة' },
  {
    code: 'outside_zones',
    labelEn: 'Customers outside our areas',
    labelAr: 'العملاء خارج مناطقنا',
  },
  { code: 'competitor', labelEn: 'Chose a competitor', labelAr: 'اختار منافسًا' },
  { code: 'no_response', labelEn: 'Stopped answering', labelAr: 'توقف عن الرد' },
  { code: 'not_ready', labelEn: 'Not ready yet', labelAr: 'غير جاهز بعد' },
] as const;

/**
 * A website form lead names a band of orders a month; the deal starts with this estimate,
 * which the rep corrects once they talk.
 */
export const ORDERS_BAND_ESTIMATE: Record<OrdersBand, number> = {
  under_300: 150,
  '300_1000': 650,
  '1000_5000': 3000,
  over_5000: 5000,
};

/** Deal numbers are shown as DEAL-000001 (gapless, like other documents). */
export function dealNumber(n: number) {
  return `DEAL-${String(n).padStart(6, '0')}`;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const count = z.number().int().min(0).max(10_000_000);
/** Money in piastres (integer, never a float) */
const piastres = z.number().int().min(0).max(100_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const id = z.string().min(1).max(64);
const idempotencyKey = z.string().min(8).max(100);

/** A phone typed by the rep: a valid Egyptian mobile is stored as +20, anything else as typed. */
const phone = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

export const crmCompanyFields = z.object({
  brandName: z.string().trim().min(2, 'name_required').max(120),
  website: text(200),
  shopDomain: text(200),
  category: text(80),
  city: text(80),
  expectedMonthlyOrders: count.nullable().optional(),
  source: z.enum(CRM_SOURCES).default('manual'),
  note: text(2000),
});
export const crmCompanySchema = crmCompanyFields.extend({
  ownerId: id.nullable().optional(),
  idempotencyKey,
});
export type CrmCompanyBody = z.infer<typeof crmCompanySchema>;
export const crmCompanyUpdateSchema = crmCompanyFields
  .omit({ source: true })
  .partial()
  .extend({
    source: z.enum(CRM_SOURCES).optional(),
    merchantId: id.nullable().optional(),
  });
export type CrmCompanyUpdateBody = z.infer<typeof crmCompanyUpdateSchema>;

export const crmContactSchema = z.object({
  name: z.string().trim().min(2, 'name_required').max(120),
  role: text(80),
  phone,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'invalid_email')
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  whatsapp: z.boolean().default(false),
});
export type CrmContactBody = z.infer<typeof crmContactSchema>;
export const crmContactUpdateSchema = crmContactSchema.partial();
export type CrmContactUpdateBody = z.infer<typeof crmContactUpdateSchema>;

const dealFields = {
  title: text(160),
  expectedMonthlyOrders: count.nullable().optional(),
  expectedMonthlyFeePiastres: piastres.nullable().optional(),
  expectedCloseDate: day.nullable().optional(),
};

/**
 * A new deal: for a company we already have (companyId) or a new one with its first contact.
 * Without ownerId a rep's deal is theirs; a manager's stays unassigned (the leads queue).
 */
export const crmDealCreateSchema = z
  .object({
    companyId: id.optional(),
    company: crmCompanyFields.optional(),
    contact: crmContactSchema.optional(),
    ownerId: id.nullable().optional(),
    idempotencyKey,
    ...dealFields,
  })
  .refine((v) => !!v.companyId !== !!v.company, 'company_required');
export type CrmDealCreateBody = z.infer<typeof crmDealCreateSchema>;

export const crmDealUpdateSchema = z
  .object({ ...dealFields, merchantId: id.nullable().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing_to_change');
export type CrmDealUpdateBody = z.infer<typeof crmDealUpdateSchema>;

/** Moving a deal: lost needs a reason from the list, or "other" with a note. */
export const crmStageSchema = z
  .object({
    stage: z.enum(CRM_STAGES),
    lostReason: z.string().trim().min(1).max(40).optional(),
    lostNote: text(1000),
  })
  .refine((v) => v.stage !== 'lost' || !!v.lostReason, {
    message: 'lost_reason_required',
    path: ['lostReason'],
  })
  .refine((v) => v.stage !== 'lost' || v.lostReason !== LOST_REASON_OTHER || !!v.lostNote, {
    message: 'lost_note_required',
    path: ['lostNote'],
  });
export type CrmStageBody = z.infer<typeof crmStageSchema>;

export const crmOwnerSchema = z.object({ ownerId: id.nullable() });
export type CrmOwnerBody = z.infer<typeof crmOwnerSchema>;

/**
 * An activity on a deal (or on a company without a deal). With dueAt and not done it is a
 * planned next step; done logs what happened.
 */
export const crmActivitySchema = z
  .object({
    dealId: id.optional(),
    companyId: id.optional(),
    type: z.enum(CRM_ACTIVITY_TYPES),
    subject: z.string().trim().min(2, 'subject_required').max(160),
    notes: text(4000),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    done: z.boolean().default(false),
    outcome: text(1000),
    ownerId: id.optional(),
    idempotencyKey,
  })
  .refine((v) => !!v.dealId || !!v.companyId, 'deal_or_company_required')
  .refine((v) => v.done || !!v.dueAt, { message: 'due_required', path: ['dueAt'] });
export type CrmActivityBody = z.infer<typeof crmActivitySchema>;

export const crmActivityUpdateSchema = z.object({
  subject: z.string().trim().min(2).max(160).optional(),
  notes: text(4000),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  outcome: text(1000),
});
export type CrmActivityUpdateBody = z.infer<typeof crmActivityUpdateSchema>;

export const crmActivityDoneSchema = z.object({ outcome: text(1000) });
export type CrmActivityDoneBody = z.infer<typeof crmActivityDoneSchema>;

export const crmLostReasonSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'invalid_code')
    .refine((v) => v !== LOST_REASON_OTHER, 'invalid_code'),
  labelEn: z.string().trim().min(2).max(80),
  labelAr: z.string().trim().min(2).max(80),
});
export type CrmLostReasonBody = z.infer<typeof crmLostReasonSchema>;
export const crmLostReasonUpdateSchema = z.object({
  labelEn: z.string().trim().min(2).max(80).optional(),
  labelAr: z.string().trim().min(2).max(80).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type CrmLostReasonUpdateBody = z.infer<typeof crmLostReasonUpdateSchema>;

// ─── pure rules the board, the lists and the tests share ───────────────────────

const DAY_MS = 24 * 60 * 60_000;

/** Whole days a deal has been in its stage. */
export function daysInStage(stageChangedAt: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / DAY_MS));
}

/**
 * The state of a deal's next step: none (an open deal without one is flagged), overdue (its
 * date passed), due (today or later). Closed deals need none.
 */
export function nextStepState(
  deal: { stage: string; nextStepAt: Date | string | null },
  now: Date = new Date(),
): 'closed' | 'none' | 'overdue' | 'planned' {
  if (!isOpenStage(deal.stage)) return 'closed';
  if (!deal.nextStepAt) return 'none';
  return new Date(deal.nextStepAt).getTime() < now.getTime() ? 'overdue' : 'planned';
}
