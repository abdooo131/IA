import { z } from 'zod';

// Emails to merchants, packaging stock (our own consumables) and purchase orders.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .regex(/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/, 'invalid_email');

// ─── email ─────────────────────────────────────────────────────────────────────

/** What we email merchants; each can be switched off per merchant. */
export const EMAIL_KINDS = ['statement', 'payout_paid', 'invoice'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const EMAIL_LANGUAGES = ['en', 'ar'] as const;
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number];

export const merchantEmailSettingsSchema = z.object({
  /** Up to five addresses; empty sends to the merchant's contact email */
  billingEmails: z.array(email).max(5),
  language: z.enum(EMAIL_LANGUAGES),
  /** Kinds the merchant does not want */
  optOuts: z.array(z.enum(EMAIL_KINDS)).max(EMAIL_KINDS.length),
});
export type MerchantEmailSettings = z.infer<typeof merchantEmailSettingsSchema>;

// ─── packaging ─────────────────────────────────────────────────────────────────

export const packagingItemSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'invalid_code'),
  nameEn: text(2, 80),
  nameAr: text(2, 80),
  unit: text(1, 20).default('piece'),
  /** The expected price of one unit, used for units found in a count */
  unitCostPiastres: z.number().int().min(0).max(100_000_000).default(0),
  /** A box size staff may choose at packing */
  isBox: z.boolean().default(false),
});
export const updatePackagingItemSchema = packagingItemSchema
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

/** Packaging bought and paid at once from a bank or cash box (no purchase order); the store is in the address. */
export const packagingPurchaseSchema = z.object({
  itemId: id,
  quantity: z.number().int().min(1).max(1_000_000),
  /** What was paid for all the units, before VAT */
  amountPiastres: z.number().int().min(1).max(1_000_000_000),
  moneyAccountId: id,
  reference: text(2, 100),
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

export const packagingAdjustSchema = z.object({
  itemId: id,
  /** Signed: found units are positive, lost or damaged units negative */
  quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'invalid_quantity'),
  reason: text(3, 200),
  idempotencyKey: key,
});

export const packagingCountSchema = z.object({
  itemId: id,
  counted: z.number().int().min(0).max(1_000_000),
  idempotencyKey: key,
});

/** The packaging one order uses, for everyone, a store, a merchant, or a merchant at a store. */
export const packagingRecipeSchema = z.object({
  darkStoreId: id.nullable().optional(),
  merchantId: id.nullable().optional(),
  lines: z.array(z.object({ itemId: id, quantity: z.number().int().min(1).max(100) })).max(20),
});

// ─── purchase orders ───────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(6, '0');
export const purchaseOrderNumber = (n: number) => `PO-${pad(n)}`;

export const PURCHASE_ORDER_STATUSES = [
  'requested',
  'approved',
  'ordered',
  'received',
  'billed',
  'closed',
  'rejected',
  'cancelled',
] as const;
export type PurchaseOrderStatusName = (typeof PURCHASE_ORDER_STATUSES)[number];

export const purchaseOrderSchema = z.object({
  supplierId: id,
  darkStoreId: id.optional(),
  note: text(0, 300).optional(),
  quotePhotoId: id.optional(),
  lines: z
    .array(
      z
        .object({
          /** A packaging item (received into packaging stock), or... */
          packagingItemId: id.optional(),
          /** ...an expense category for anything else */
          expenseAccountId: id.optional(),
          description: text(2, 160),
          quantity: z.number().int().min(1).max(1_000_000),
          unitPricePiastres: z.number().int().min(0).max(1_000_000_000),
        })
        .refine((l) => !!l.packagingItemId !== !!l.expenseAccountId, 'packaging_or_expense'),
    )
    .min(1)
    .max(50),
  idempotencyKey: key,
});
export type PurchaseOrderBody = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderDecisionSchema = z.object({
  approve: z.boolean(),
  note: text(0, 300).optional(),
});

export const purchaseOrderReceiveSchema = z.object({
  lines: z
    .array(z.object({ lineId: id, quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .max(50),
  idempotencyKey: key,
});

export const purchaseOrderBillSchema = z.object({
  /** The supplier's own invoice number */
  reference: text(2, 100),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** What the supplier billed before VAT; at most the tolerance above the ordered prices */
  netPiastres: z.number().int().min(1).max(1_000_000_000),
  vatPiastres: z.number().int().min(0).max(1_000_000_000).default(0),
  idempotencyKey: key,
});

export const purchaseOrderCloseSchema = z.object({ note: text(3, 300) });
