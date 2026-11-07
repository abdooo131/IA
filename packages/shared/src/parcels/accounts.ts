// The chart of accounts the system posts to. Admin can add more expense accounts.
// Wallets are not separate accounts: each line on a wallet account names its party
// (a merchant, courier, agent or hub), so one account holds every wallet of its kind.

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type PartyType = 'MERCHANT' | 'COURIER' | 'AGENT' | 'HUB' | 'SUPPLIER';

export interface AccountDef {
  code: string;
  name: string;
  nameAr: string;
  type: AccountType;
  party?: PartyType;
}

export const ACCOUNTS = {
  BANK: { code: '1000', name: 'Bank', nameAr: 'البنك', type: 'ASSET' },
  HUB_SAFE: {
    code: '1100',
    name: 'Hub safes',
    nameAr: 'خزائن المراكز',
    type: 'ASSET',
    party: 'HUB',
  },
  COURIER_CASH: {
    code: '1200',
    name: 'Cash with couriers',
    nameAr: 'نقدية مع المندوبين',
    type: 'ASSET',
    party: 'COURIER',
  },
  PACKAGING_STOCK: {
    code: '1300',
    name: 'Packaging stock',
    nameAr: 'مخزون مواد التغليف',
    type: 'ASSET',
  },
  VAT_INPUT: {
    code: '1500',
    name: 'VAT paid on purchases',
    nameAr: 'ضريبة القيمة المضافة على المشتريات',
    type: 'ASSET',
  },
  MERCHANT_WALLET: {
    code: '2100',
    name: 'Merchant balances',
    nameAr: 'أرصدة التجار',
    type: 'LIABILITY',
    party: 'MERCHANT',
  },
  COURIER_WALLET: {
    code: '2200',
    name: 'Courier wallets',
    nameAr: 'محافظ المندوبين',
    type: 'LIABILITY',
    party: 'COURIER',
  },
  AGENT_PAYABLE: {
    code: '2300',
    name: 'Owed to agents',
    nameAr: 'مستحقات الوكلاء',
    type: 'LIABILITY',
    party: 'AGENT',
  },
  VAT_OUTPUT: {
    code: '2400',
    name: 'VAT on sales',
    nameAr: 'ضريبة القيمة المضافة على المبيعات',
    type: 'LIABILITY',
  },
  WHT_PAYABLE: {
    code: '2410',
    name: 'Withholding tax to pay',
    nameAr: 'ضريبة الخصم والإضافة المستحقة',
    type: 'LIABILITY',
  },
  SUPPLIER_PAYABLE: {
    code: '2500',
    name: 'Owed to suppliers',
    nameAr: 'مستحق للموردين',
    type: 'LIABILITY',
    party: 'SUPPLIER',
  },
  EQUITY: {
    code: '3000',
    name: 'Owner equity and opening balances',
    nameAr: 'حقوق الملكية والأرصدة الافتتاحية',
    type: 'EQUITY',
  },
  SHIPPING_REVENUE: {
    code: '4000',
    name: 'Shipping revenue',
    nameAr: 'إيرادات الشحن',
    type: 'INCOME',
  },
  COD_FEE_REVENUE: {
    code: '4010',
    name: 'COD fee revenue',
    nameAr: 'إيرادات رسوم التحصيل',
    type: 'INCOME',
  },
  RETURN_FEE_REVENUE: {
    code: '4020',
    name: 'Return fee revenue',
    nameAr: 'إيرادات رسوم المرتجع',
    type: 'INCOME',
  },
  PAYOUT_FEE_REVENUE: {
    code: '4030',
    name: 'Cash out fee revenue',
    nameAr: 'إيرادات رسوم السحب',
    type: 'INCOME',
  },
  PACKAGING_SALES: {
    code: '4040',
    name: 'Packaging sales',
    nameAr: 'مبيعات مواد التغليف',
    type: 'INCOME',
  },
  OTHER_INCOME: {
    code: '4900',
    name: 'Other income (penalties, cash over)',
    nameAr: 'إيرادات أخرى (جزاءات وزيادة نقدية)',
    type: 'INCOME',
  },
  COURIER_PAY: { code: '5000', name: 'Courier pay', nameAr: 'أجور المندوبين', type: 'EXPENSE' },
  AGENT_COMMISSION: {
    code: '5010',
    name: 'Agent commission',
    nameAr: 'عمولة الوكلاء',
    type: 'EXPENSE',
  },
  VEHICLE_RENT: { code: '5020', name: 'Vehicle rent', nameAr: 'إيجار المركبات', type: 'EXPENSE' },
  SPECIAL_VEHICLES: {
    code: '5030',
    name: 'Special vehicles',
    nameAr: 'المركبات الخاصة',
    type: 'EXPENSE',
  },
  RENT: { code: '5210', name: 'Rent', nameAr: 'الإيجارات', type: 'EXPENSE' },
  UTILITIES: { code: '5220', name: 'Utilities', nameAr: 'المرافق', type: 'EXPENSE' },
  SALARIES: { code: '5230', name: 'Salaries', nameAr: 'المرتبات', type: 'EXPENSE' },
  FUEL: { code: '5240', name: 'Fuel and transport', nameAr: 'الوقود والمواصلات', type: 'EXPENSE' },
  SUPPLIES: {
    code: '5250',
    name: 'Packaging and supplies',
    nameAr: 'مواد التغليف والمستلزمات',
    type: 'EXPENSE',
  },
  PACKAGING_COST: {
    code: '5255',
    name: 'Cost of packaging sold',
    nameAr: 'تكلفة مواد التغليف المباعة',
    type: 'EXPENSE',
  },
  BANK_CHARGES: { code: '5260', name: 'Bank charges', nameAr: 'مصاريف بنكية', type: 'EXPENSE' },
  LOST_PARCELS: {
    code: '5300',
    name: 'Lost and damaged parcels',
    nameAr: 'شحنات مفقودة وتالفة',
    type: 'EXPENSE',
  },
  OTHER_EXPENSES: { code: '5290', name: 'Other expenses', nameAr: 'مصروفات أخرى', type: 'EXPENSE' },
} as const satisfies Record<string, AccountDef>;

export type AccountKey = keyof typeof ACCOUNTS;
export const ACCOUNT_LIST: AccountDef[] = Object.values(ACCOUNTS);

/** Assets and expenses grow with debits; the rest grow with credits. */
export function normalBalance(type: AccountType): 'DEBIT' | 'CREDIT' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}
