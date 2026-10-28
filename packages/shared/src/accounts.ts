import { z } from 'zod';

// Chart of accounts. The first digit of a code is its category, the next three its group:
//
//   1000 assets       1100 banks · 1200 cash boxes · 1300 cash with riders · 1400 other assets
//   2000 liabilities  2100 merchants · 2200 rider bonuses · 2300 taxes · 2400 other liabilities
//   3000 equity       3100 owner capital · 3200 owner drawings
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
  {
    code: 1400,
    category: 'asset',
    key: 'other_assets',
    party: false,
    manualType: 'other_asset',
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
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_day');
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
  idempotencyKey: key,
});

export const otherIncomeSchema = z.object({
  incomeAccountId: id,
  moneyAccountId: id,
  amountPiastres: piastres,
  reference,
  memo: z.string().trim().min(3).max(300),
  day: onDay,
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
  idempotencyKey: key,
});
export type JournalEntryBody = z.infer<typeof journalEntrySchema>;

/** Which bank paid or received; empty uses the main bank (CIB, 1101). */
export const bankChoice = z.object({ bankAccountId: id.optional() });
