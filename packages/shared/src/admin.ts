import { z } from 'zod';
import { passwordSchema } from './auth';
import { egyptianPhoneSchema } from './phone';
import { ROLES } from './roles';
import { SETTING_KEYS } from './settings';

const id = z.string().min(1).max(64);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Badge codes are printed on riders' cards and scanned at hand over. */
export const badgeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,20}$/, 'invalid_badge_code');

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  phone: egyptianPhoneSchema.nullable().optional(),
  role: z.enum(ROLES),
  password: passwordSchema,
  darkStoreId: id.nullable().optional(),
  merchantId: id.nullable().optional(),
  badgeCode: badgeCodeSchema.nullable().optional(),
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: egyptianPhoneSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  darkStoreId: id.nullable().optional(),
  merchantId: id.nullable().optional(),
  badgeCode: badgeCodeSchema.nullable().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });

export const merchantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().toLowerCase().email().max(200).nullable().optional(),
  contactPhone: egyptianPhoneSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});
export type MerchantBody = z.infer<typeof merchantSchema>;

/** EGP as typed by people ("149.5") turned into integer piastres, never a float in storage. */
export const egpToPiastresSchema = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const text = String(value).trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_price' });
      return z.NEVER;
    }
    const [whole, fraction = ''] = text.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .pipe(z.number().int().min(0).max(100_000_000));

export const skuCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'invalid_sku');

export const skuSchema = z.object({
  merchantId: id,
  sku: skuCodeSchema,
  barcode: optionalText(64),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  pricePiastres: z.number().int().min(0).max(100_000_000),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type SkuBody = z.infer<typeof skuSchema>;

export const updateSkuSchema = skuSchema.omit({ merchantId: true, sku: true }).partial();
export type UpdateSkuBody = z.infer<typeof updateSkuSchema>;

/**
 * One row of a product import file. Columns: sku, barcode, title_en, title_ar, price_egp,
 * weight_grams (optional). An empty title_ar falls back to title_en.
 */
export const skuImportRowSchema = z
  .object({
    sku: skuCodeSchema,
    barcode: optionalText(64),
    title_en: z.string().trim().min(1).max(200),
    title_ar: z.string().trim().max(200).optional(),
    price_egp: egpToPiastresSchema,
    weight_grams: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined || v === '' ? null : Number(v)))
      .pipe(z.number().int().min(0).max(1_000_000).nullable()),
  })
  .transform((r) => ({
    sku: r.sku,
    barcode: r.barcode ?? null,
    titleEn: r.title_en,
    titleAr: r.title_ar || r.title_en,
    pricePiastres: r.price_egp,
    weightGrams: r.weight_grams,
  }));
export type SkuImportRow = z.output<typeof skuImportRowSchema>;

export const skuImportSchema = z.object({
  merchantId: id,
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});

export const settingUpdateSchema = z.object({
  key: z.enum(SETTING_KEYS as [string, ...string[]]),
  /** "global" or a dark store id */
  scope: z.string().min(1).max(64).default('global'),
  /** null removes a store override, so the global value applies again */
  value: z.number().int().nullable(),
});
