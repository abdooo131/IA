import { z } from 'zod';
import { isCalendarDay } from './hours';

// Chart of accounts. The first digit of a code is its category, the next three its group:
//
//   1000 assets       1100 banks · 1200 cash boxes · 1300 cash with riders · 1350 rider dues
//                     1400 other assets
//                     1500 staff advances
//   2000 liabilities  2100 merchants · 2200 rider bonuses · 2300 taxes · 2400 other liabilities
//   3000 equity       3100 owner capital · 3200 owner drawings · 3300 opening balances
//   4000 income       4100 fees · 4200 other income
//   5000 expenses     5100 rider bonuses · 5200 damage · 5300 cash differences
//                     5400 operating expenses · 5500 bank charges
//
// Company accounts take the next number in their group (1101, 1102...). A party's wallet
// (merchant, rider) takes the next number under its group with four digits (2100-0001).

export const ACCOUNT_CATEGORIES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountCategoryName = (typeof ACCOUNT_CATEGORIES)[number];

/** Account kinds finance can open by hand. */
export const MANUAL_ACCOUNT_TYPES = [
  'bank',
  'cash_box',
  'other_asset',
  'other_liability',
  'equity',
  'other_income',
  'expense',
] as const;
export type ManualAccountType = (typeof MANUAL_ACCOUNT_TYPES)[number];

export interface AccountGroup {
  code: number;
  category: AccountCategoryName;
  /** Translation key under finance.accounts.groups */
  key: string;
  /** Each party (merchant, rider) has its own wallet: codes like 2100-0001 */
  party: boolean;
  /** Finance can open accounts here, of this kind */
  manualType: ManualAccountType | null;
  /** Money we can move: banks and cash boxes */
  money: boolean;
}

export const ACCOUNT_GROUPS: AccountGroup[] = [
  { code: 1100, category: 'asset', key: 'banks', party: false, manualType: 'bank', money: true },
  {
    code: 1200,
    category: 'asset',
    key: 'cash_boxes',
    party: false,
    manualType: 'cash_box',
    money: true,
  },
  { code: 1300, category: 'asset', key: 'rider_cash', party: true, manualType: null, money: false },
  { code: 1350, category: 'asset', key: 'rider_dues', party: true, manualType: null, money: false },
  {
    code: 1400,
    category: 'asset',
    key: 'other_assets',
    party: false,
    manualType: 'other_asset',
    money: false,
  },
  {
    code: 1500,
    category: 'asset',
    key: 'staff_advances',
    party: true,
    manualType: null,
    money: false,
  },
  {
    code: 1600,
    category: 'asset',
    key: 'fixed_assets',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 1700,
    category: 'asset',
    key: 'accumulated_depreciation',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 2100,
    category: 'liability',
    key: 'merchants',
    party: true,
    manualType: null,
    money: false,
  },
  {
    code: 2200,
    category: 'liability',
    key: 'rider_bonuses',
    party: true,
    manualType: null,
    money: false,
  },
  { code: 2300, category: 'liability', key: 'taxes', party: false, manualType: null, money: false },
  {
    code: 2400,
    category: 'liability',
    key: 'other_liabilities',
    party: false,
    manualType: 'other_liability',
    money: false,
  },
  {
    code: 2500,
    category: 'liability',
    key: 'suppliers',
    party: true,
    manualType: null,
    money: false,
  },
  {
    code: 3100,
    category: 'equity',
    key: 'capital',
    party: false,
    manualType: 'equity',
    money: false,
  },
  {
    code: 3200,
    category: 'equity',
    key: 'drawings',
    party: false,
    manualType: 'equity',
    money: false,
  },
  {
    code: 3300,
    category: 'equity',
    key: 'opening_balances',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 3400,
    category: 'equity',
    key: 'retained_earnings',
    party: false,
    manualType: null,
    money: false,
  },
  { code: 4100, category: 'revenue', key: 'fees', party: false, manualType: null, money: false },
  {
    code: 4200,
    category: 'revenue',
    key: 'other_income',
    party: false,
    manualType: 'other_income',
    money: false,
  },
  {
    code: 5100,
    category: 'expense',
    key: 'rider_costs',
    party: false,
    manualType: null,
    money: false,
  },
  { code: 5200, category: 'expense', key: 'damage', party: false, manualType: null, money: false },
  {
    code: 5300,
    category: 'expense',
    key: 'cash_differences',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 5400,
    category: 'expense',
    key: 'operating_expenses',
    party: false,
    manualType: 'expense',
    money: false,
  },
  {
    code: 5500,
    category: 'expense',
    key: 'bank_charges',
    party: false,
    manualType: 'expense',
    money: false,
  },
  {
    code: 5700,
    category: 'expense',
    key: 'staff_costs',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 5600,
    category: 'expense',
    key: 'depreciation',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 5800,
    category: 'expense',
    key: 'income_tax',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 5900,
    category: 'expense',
    key: 'other_costs',
    party: false,
    manualType: null,
    money: false,
  },
  // Cheques: what we were given and not yet collected (1151), what we wrote and the bank has
  // not yet paid (2451), and the security deposits merchants left with us (2600-0001...).
  {
    code: 1150,
    category: 'asset',
    key: 'cheques_under_collection',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 2450,
    category: 'liability',
    key: 'cheques_payable',
    party: false,
    manualType: null,
    money: false,
  },
  {
    code: 2600,
    category: 'liability',
    key: 'merchant_deposits',
    party: true,
    manualType: null,
    money: false,
  },
];

export function accountGroup(code: number) {
  return ACCOUNT_GROUPS.find((g) => g.code === code);
}

/** Debit balances are normal for assets and expenses; the rest are shown with the sign flipped. */
export function debitNormal(category: AccountCategoryName) {
  return category === 'asset' || category === 'expense';
}

const pad = (n: number) => String(n).padStart(6, '0');
/** Journal voucher number, for example JV-000123 */
export const entryNumber = (n: number) => `JV-${pad(n)}`;
export const payoutNumber = (n: number) => `PAY-${pad(n)}`;
export const handoverNumber = (n: number) => `CH-${pad(n)}`;

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const piastres = z.number().int().min(1).max(1_000_000_000);
const day = z.string().refine(isCalendarDay, 'invalid_day');
const name = z.string().trim().min(2).max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createAccountSchema = z
  .object({
    groupCode: z.number().int(),
    nameEn: name,
    nameAr: name,
    bankName: optionalText(80),
    accountNumber: optionalText(40),
    iban: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/\s+/g, ''))
      .refine((v) => v === '' || /^EG\d{27}$/.test(v), 'invalid_iban')
      .optional()
      .transform((v) => (v ? v : undefined)),
    note: optionalText(300),
  })
  .superRefine((v, ctx) => {
    const group = accountGroup(v.groupCode);
    if (!group?.manualType)
      ctx.addIssue({ code: 'custom', path: ['groupCode'], message: 'group_not_open' });
    if (group?.code === 1100 && (!v.bankName || !v.accountNumber))
      ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'bank_details_required' });
  });
export type CreateAccountBody = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  nameEn: name.optional(),
  nameAr: name.optional(),
  bankName: optionalText(80),
  accountNumber: optionalText(40),
  iban: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/\s+/g, ''))
    .refine((v) => v === '' || /^EG\d{27}$/.test(v), 'invalid_iban')
    .optional(),
  note: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAccountBody = z.infer<typeof updateAccountSchema>;

/** A date in the past or today (Cairo); money events are never dated in the future. */
const onDay = day.optional();
const reference = z.string().trim().min(2).max(100);

export const moneyTransferSchema = z.object({
  fromAccountId: id,
  toAccountId: id,
  amountPiastres: piastres,
  reference,
  memo: optionalText(300),
  day: onDay,
  idempotencyKey: key,
});

export const expenseSchema = z.object({
  expenseAccountId: id,
  paidFromAccountId: id,
  amountPiastres: piastres,
  /** VAT paid on the bill, part of the amount; booked against VAT payable */
  vatPiastres: z.number().int().min(0).max(1_000_000_000).default(0),
  reference,
  memo: z.string().trim().min(3).max(300),
  day: onDay,
  /** A receipt photo uploaded first (POST /photos?kind=receipt) */
  receiptPhotoId: id.optional(),
  /** The dark store the cost belongs to; empty is company wide */
  darkStoreId: id.optional(),
  idempotencyKey: key,
});

export const capitalSchema = z.object({
  direction: z.enum(['in', 'out']),
  moneyAccountId: id,
  equityAccountId: id.optional(),
  amountPiastres: piastres,
  reference,
  memo: optionalText(300),
  day: onDay,
  /** A receipt photo uploaded first (POST /photos?kind=receipt) */
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

export const otherIncomeSchema = z.object({
  incomeAccountId: id,
  moneyAccountId: id,
  amountPiastres: piastres,
  reference,
  memo: z.string().trim().min(3).max(300),
  day: onDay,
  /** A receipt photo uploaded first (POST /photos?kind=receipt) */
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

/** A free journal entry for the accountant: lines must balance, a reason is required. */
export const journalEntrySchema = z.object({
  lines: z
    .array(
      z.object({
        accountId: id,
        debitPiastres: z.number().int().min(0).max(1_000_000_000),
        creditPiastres: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(2)
    .max(20),
  reason: z.string().trim().min(5).max(300),
  day: onDay,
  /** An accrual: reversed by itself on the first day of the next month */
  reverseNextMonth: z.boolean().optional(),
  idempotencyKey: key,
});
export type JournalEntryBody = z.infer<typeof journalEntrySchema>;

// ─── suppliers, bills, taxes, recurring, prepayments, fixed assets ──────────────

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month');
/** Withholding tax as basis points: 100 is 1% */
const basisPoints = z.number().int().min(0).max(10_000);

export const billNumber = (n: number) => `BILL-${pad(n)}`;

export const supplierSchema = z.object({
  name,
  taxId: optionalText(30),
  phone: optionalText(20),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'invalid_email')
    .optional()
    .transform((v) => (v ? v : undefined)),
  whtBp: basisPoints.default(0),
  defaultExpenseAccountId: id.optional(),
});
export const updateSupplierSchema = supplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const billSchema = z.object({
  supplierId: id,
  reference,
  billDate: day,
  dueDate: day,
  expenseAccountId: id.optional(),
  darkStoreId: id.optional(),
  netPiastres: piastres.optional(),
  vatPiastres: z.number().int().min(0).max(1_000_000_000).default(0),
  memo: optionalText(300),
  /** The person the bill is for (an outsourced worker's month) */
  userId: id.optional(),
  /** A bill in another currency: its code, the amounts in its cents and the rate on the bill */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  foreignNetCents: z.number().int().min(1).max(1_000_000_000).optional(),
  foreignVatCents: z.number().int().min(0).max(1_000_000_000).optional(),
  /** EGP for one unit, as text with up to 6 decimals ("48.75") */
  fxRate: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6})?$/)
    .optional(),
  idempotencyKey: key,
});

export const cancelBillSchema = z.object({ reason: z.string().trim().min(5).max(300) });

export const billPaymentSchema = z.object({
  /** In EGP; for a bill in another currency, use foreignAmountCents and fxRate instead */
  amountPiastres: piastres.optional(),
  foreignAmountCents: z.number().int().min(1).max(1_000_000_000).optional(),
  fxRate: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6})?$/)
    .optional(),
  moneyAccountId: id,
  reference,
  advanceRecoveryPiastres: z.number().int().min(0).max(1_000_000_000).optional(),
  day: onDay,
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

export const taxPaymentSchema = z.object({
  tax: z.enum(['vat', 'wht', 'payroll_tax', 'social_insurance', 'martyrs_fund', 'corporate_tax']),
  amountPiastres: piastres,
  moneyAccountId: id,
  reference,
  day: onDay,
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

export const recurringSchema = z
  .object({
    name,
    expenseAccountId: id,
    paidFromAccountId: id,
    amountPiastres: piastres,
    vatPiastres: z.number().int().min(0).max(1_000_000_000).default(0),
    darkStoreId: id.optional(),
    memo: z.string().trim().min(3).max(300),
    reference,
    dayOfMonth: z.number().int().min(1).max(28),
    startMonth: month,
    endMonth: month.optional(),
  })
  .refine((v) => !v.endMonth || v.endMonth >= v.startMonth, {
    path: ['endMonth'],
    message: 'end_before_start',
  });

export const prepaymentSchema = z.object({
  name,
  expenseAccountId: id,
  amountPiastres: piastres,
  months: z.number().int().min(1).max(120),
  startMonth: month,
  darkStoreId: id.optional(),
  moneyAccountId: id,
  reference,
  day: onDay,
  receiptPhotoId: id.optional(),
  idempotencyKey: key,
});

export const assetSchema = z
  .object({
    name,
    amountPiastres: piastres,
    salvagePiastres: z.number().int().min(0).max(1_000_000_000).default(0),
    lifeMonths: z.number().int().min(1).max(600),
    startMonth: month,
    darkStoreId: id.optional(),
    moneyAccountId: id,
    reference,
    day: onDay,
    receiptPhotoId: id.optional(),
    idempotencyKey: key,
  })
  .refine((v) => v.salvagePiastres < v.amountPiastres, {
    path: ['salvagePiastres'],
    message: 'invalid_salvage',
  });

export const paymentRequestSchema = z.object({ note: optionalText(300) });

export const budgetSchema = z.object({
  month,
  accountId: id,
  darkStoreId: id.optional(),
  amountPiastres: z.number().int().min(0).max(1_000_000_000),
});
export const yearCloseSchema = z.object({ year: z.number().int().min(2020).max(2100) });
export const bankMatchSchema = z.object({ ledgerLineId: id });
export const bankIgnoreSchema = z.object({ note: z.string().trim().min(5).max(300) });

// ─── tax invoices and the e-invoice system ──────────────────────────────────────

const shortText = (max: number) => z.string().trim().max(max);
export const companyProfileSchema = z.object({
  legalNameEn: shortText(200).optional(),
  legalNameAr: shortText(200).optional(),
  taxRegistrationNumber: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{9}$/.test(v), 'invalid_tax_number')
    .optional(),
  activityCode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}$/.test(v), 'invalid_activity_code')
    .optional(),
  branchId: shortText(20).optional(),
  governorate: shortText(100).optional(),
  regionCity: shortText(100).optional(),
  street: shortText(200).optional(),
  buildingNumber: shortText(50).optional(),
  itemCodes: z.record(z.string(), shortText(100)).optional(),
  etaEnabled: z.boolean().optional(),
});

export const merchantTaxSchema = z.object({
  legalName: shortText(200).nullable().optional(),
  taxRegistrationNumber: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{9}$/.test(v), 'invalid_tax_number')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  taxGovernorate: shortText(100).nullable().optional(),
  taxRegionCity: shortText(100).nullable().optional(),
  taxStreet: shortText(200).nullable().optional(),
  taxBuildingNumber: shortText(50).nullable().optional(),
});

export const prepareInvoicesSchema = z.object({ month });
export const creditNoteSchema = z.object({
  amountPiastres: piastres,
  reason: z.string().trim().min(5).max(300),
  idempotencyKey: key,
});
export const signaturesSchema = z.object({
  signatures: z
    .array(z.object({ id, signature: z.string().min(10).max(20_000) }))
    .min(1)
    .max(100),
});

export const corporateTaxSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  amountPiastres: z.number().int().min(0).max(2_000_000_000),
});

const ibanText = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/g, ''))
  .refine((v) => v === '' || /^EG\d{27}$/.test(v), 'invalid_iban');
export const merchantBankSchema = z.object({
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z.string().trim().max(40).nullable().optional(),
  iban: ibanText.nullable().optional(),
  beneficiaryName: z.string().trim().max(120).nullable().optional(),
});
export const disposeAssetSchema = z.object({
  salePiastres: z.number().int().min(0).max(1_000_000_000),
  moneyAccountId: id.optional(),
  reason: z.string().trim().min(5).max(300),
  day: onDay,
  idempotencyKey: key,
});
