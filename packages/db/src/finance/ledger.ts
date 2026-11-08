import type { AccountCategory, Company, LedgerAccountType, Prisma } from '@prisma/client';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';

type Tx = Prisma.TransactionClient;

/** Where money sits. Company accounts have no owner; wallets belong to one party. */
export type AccountRef =
  | { type: 'merchant'; merchantId: string }
  | { type: 'rider_cash'; riderId: string }
  | { type: 'rider_bonus'; riderId: string }
  /** What a rider owes the company, taken from their next withdrawal (1350) */
  | { type: 'rider_dues'; riderId: string }
  | { type: 'store_cash'; darkStoreId: string }
  | { type: 'staff_advance'; userId: string }
  | { type: 'supplier'; supplierId: string }
  | { type: 'merchant_deposit'; merchantId: string }
  /** Parcel network wallets */
  | { type: 'hub_safe'; hubId: string }
  | { type: 'courier_cash'; userId: string }
  | { type: 'courier_wallet'; userId: string }
  | { type: 'agent_payable'; agentId: string }
  | { type: SystemAccountKey }
  /** Any account by its id: banks, cash boxes, expense categories and the rest */
  | { id: string };

/** Accounts that exist once, by key. Some share a type (wht_payable is an other liability). */
export type SystemAccountKey =
  | 'bank'
  | 'revenue'
  | 'vat_payable'
  | 'rider_bonus_expense'
  | 'cash_difference'
  | 'damage_expense'
  | 'wht_payable'
  | 'prepaid'
  | 'fixed_assets'
  | 'accumulated_depreciation'
  | 'depreciation_expense'
  | 'retained_earnings'
  | 'payroll_tax_payable'
  | 'social_insurance_payable'
  | 'martyrs_fund_payable'
  | 'social_insurance_expense'
  | 'staff_bonus_expense'
  | 'corporate_tax_payable'
  | 'income_tax_expense'
  | 'fx_difference'
  | 'asset_disposal'
  | 'cheques_under_collection'
  | 'cheques_payable'
  | 'packaging_stock'
  | 'goods_received'
  // Shiply parcel network income and costs
  | 'parcel_shipping_revenue'
  | 'parcel_cod_fee_revenue'
  | 'parcel_return_fee_revenue'
  | 'parcel_cashout_fee_revenue'
  | 'parcel_packaging_sales'
  | 'parcel_other_income'
  | 'parcel_courier_pay'
  | 'parcel_agent_commission'
  | 'parcel_vehicle_rent'
  | 'parcel_special_vehicles'
  | 'parcel_lost_parcels'
  | 'parcel_packaging_cost';

/** Accounts that exist once, with the code and name they take when first used. */
const SYSTEM_ACCOUNTS: Record<
  SystemAccountKey,
  { type: LedgerAccountType; group: number; code: string; nameEn: string; nameAr: string }
> = {
  parcel_shipping_revenue: {
    type: 'revenue',
    group: 4300,
    code: '4301',
    nameEn: 'Parcel shipping',
    nameAr: 'إيرادات شحن الطرود',
  },
  parcel_cod_fee_revenue: {
    type: 'revenue',
    group: 4300,
    code: '4302',
    nameEn: 'Parcel COD fees',
    nameAr: 'رسوم تحصيل الطرود',
  },
  parcel_return_fee_revenue: {
    type: 'revenue',
    group: 4300,
    code: '4303',
    nameEn: 'Parcel return fees',
    nameAr: 'رسوم مرتجعات الطرود',
  },
  parcel_cashout_fee_revenue: {
    type: 'revenue',
    group: 4300,
    code: '4304',
    nameEn: 'Merchant cash out fees',
    nameAr: 'رسوم سحب التجار',
  },
  parcel_packaging_sales: {
    type: 'revenue',
    group: 4300,
    code: '4305',
    nameEn: 'Packaging sold to merchants',
    nameAr: 'مبيعات مواد التغليف للتجار',
  },
  parcel_other_income: {
    type: 'other_income',
    group: 4300,
    code: '4306',
    nameEn: 'Network penalties and cash over',
    nameAr: 'جزاءات وزيادة نقدية الشبكة',
  },
  parcel_courier_pay: {
    type: 'expense',
    group: 5150,
    code: '5151',
    nameEn: 'Courier pay',
    nameAr: 'أجور المناديب',
  },
  parcel_agent_commission: {
    type: 'expense',
    group: 5150,
    code: '5152',
    nameEn: 'Agent commission',
    nameAr: 'عمولة الوكلاء',
  },
  parcel_vehicle_rent: {
    type: 'expense',
    group: 5150,
    code: '5153',
    nameEn: 'Vehicle rent',
    nameAr: 'إيجار المركبات',
  },
  parcel_special_vehicles: {
    type: 'expense',
    group: 5150,
    code: '5154',
    nameEn: 'Special vehicles',
    nameAr: 'المركبات الخاصة',
  },
  parcel_lost_parcels: {
    type: 'expense',
    group: 5150,
    code: '5155',
    nameEn: 'Lost and damaged parcels',
    nameAr: 'شحنات مفقودة وتالفة',
  },
  parcel_packaging_cost: {
    type: 'expense',
    group: 5150,
    code: '5156',
    nameEn: 'Cost of packaging sold',
    nameAr: 'تكلفة مواد التغليف المباعة',
  },
  bank: {
    type: 'bank',
    group: 1100,
    code: '1101',
    nameEn: 'CIB',
    nameAr: 'البنك التجاري الدولي CIB',
  },
  vat_payable: {
    type: 'vat_payable',
    group: 2300,
    code: '2301',
    nameEn: 'VAT payable',
    nameAr: 'ضريبة القيمة المضافة المستحقة',
  },
  revenue: {
    type: 'revenue',
    group: 4100,
    code: '4101',
    nameEn: 'Delivery and service fees',
    nameAr: 'إيرادات رسوم التوصيل والخدمات',
  },
  rider_bonus_expense: {
    type: 'rider_bonus_expense',
    group: 5100,
    code: '5101',
    nameEn: 'Rider pay per delivered order',
    nameAr: 'أجر المناديب عن كل طلب مُسلَّم',
  },
  damage_expense: {
    type: 'damage_expense',
    group: 5200,
    code: '5201',
    nameEn: 'Damage paid by us',
    nameAr: 'تعويضات التلفيات',
  },
  cash_difference: {
    type: 'cash_difference',
    group: 5300,
    code: '5301',
    nameEn: 'Cash shortages and surpluses',
    nameAr: 'عجز وزيادة النقدية',
  },
  wht_payable: {
    type: 'other_liability',
    group: 2300,
    code: '2302',
    nameEn: 'Withholding tax payable',
    nameAr: 'ضريبة الخصم والإضافة المستحقة',
  },
  prepaid: {
    type: 'other_asset',
    group: 1400,
    code: '1401',
    nameEn: 'Prepaid expenses',
    nameAr: 'مصروفات مدفوعة مقدما',
  },
  fixed_assets: {
    type: 'other_asset',
    group: 1600,
    code: '1601',
    nameEn: 'Equipment and vehicles',
    nameAr: 'معدات ووسائل نقل',
  },
  accumulated_depreciation: {
    type: 'other_asset',
    group: 1700,
    code: '1701',
    nameEn: 'Accumulated depreciation',
    nameAr: 'مجمع الإهلاك',
  },
  depreciation_expense: {
    type: 'expense',
    group: 5600,
    code: '5601',
    nameEn: 'Depreciation',
    nameAr: 'مصروف الإهلاك',
  },
  retained_earnings: {
    type: 'equity',
    group: 3400,
    code: '3401',
    nameEn: 'Retained earnings',
    nameAr: 'أرباح مرحلة',
  },
  payroll_tax_payable: {
    type: 'other_liability',
    group: 2300,
    code: '2303',
    nameEn: 'Salary income tax payable',
    nameAr: 'ضريبة كسب العمل المستحقة',
  },
  social_insurance_payable: {
    type: 'other_liability',
    group: 2300,
    code: '2304',
    nameEn: 'Social insurance payable',
    nameAr: 'التأمينات الاجتماعية المستحقة',
  },
  martyrs_fund_payable: {
    type: 'other_liability',
    group: 2300,
    code: '2305',
    nameEn: 'Martyrs fund payable',
    nameAr: 'صندوق الشهداء المستحق',
  },
  social_insurance_expense: {
    type: 'expense',
    group: 5700,
    code: '5701',
    nameEn: 'Social insurance, company share',
    nameAr: 'حصة الشركة في التأمينات',
  },
  staff_bonus_expense: {
    type: 'expense',
    group: 5700,
    code: '5702',
    nameEn: 'Staff bonuses',
    nameAr: 'مكافآت العاملين',
  },
  corporate_tax_payable: {
    type: 'other_liability',
    group: 2300,
    code: '2306',
    nameEn: 'Company income tax payable',
    nameAr: 'ضريبة الدخل المستحقة على الشركة',
  },
  income_tax_expense: {
    type: 'expense',
    group: 5800,
    code: '5801',
    nameEn: 'Company income tax',
    nameAr: 'ضريبة الدخل',
  },
  fx_difference: {
    type: 'expense',
    group: 5900,
    code: '5901',
    nameEn: 'Exchange rate differences',
    nameAr: 'فروق أسعار الصرف',
  },
  asset_disposal: {
    type: 'expense',
    group: 5900,
    code: '5902',
    nameEn: 'Loss or gain on equipment sold',
    nameAr: 'خسائر أو أرباح بيع المعدات',
  },
  cheques_under_collection: {
    type: 'other_asset',
    group: 1150,
    code: '1151',
    nameEn: 'Cheques under collection',
    nameAr: 'شيكات تحت التحصيل',
  },
  cheques_payable: {
    type: 'other_liability',
    group: 2450,
    code: '2451',
    nameEn: 'Cheques payable',
    nameAr: 'شيكات مستحقة الدفع',
  },
  packaging_stock: {
    type: 'other_asset',
    group: 1400,
    code: '1402',
    nameEn: 'Packaging stock',
    nameAr: 'مخزون مواد التغليف',
  },
  goods_received: {
    type: 'other_liability',
    group: 2400,
    code: '2401',
    nameEn: 'Goods received, not billed yet',
    nameAr: 'بضائع مستلمة لم تصل فاتورتها',
  },
};

/** Opening accounts every company starts with (also created by the chart of accounts migration). */
export const DEFAULT_ACCOUNTS: {
  key: string;
  type: LedgerAccountType;
  group: number;
  code: string;
  nameEn: string;
  nameAr: string;
}[] = [
  {
    key: 'equity:capital',
    type: 'equity',
    group: 3100,
    code: '3101',
    nameEn: 'Owner capital',
    nameAr: 'رأس المال',
  },
  {
    key: 'equity:drawings',
    type: 'equity',
    group: 3200,
    code: '3201',
    nameEn: 'Owner drawings',
    nameAr: 'مسحوبات المالك',
  },
  {
    key: 'equity:opening',
    type: 'equity',
    group: 3300,
    code: '3301',
    nameEn: 'Opening balances',
    nameAr: 'أرصدة افتتاحية',
  },
  {
    key: 'other_income:general',
    type: 'other_income',
    group: 4200,
    code: '4201',
    nameEn: 'Other income',
    nameAr: 'إيرادات أخرى',
  },
  {
    key: 'expense:rent',
    type: 'expense',
    group: 5400,
    code: '5401',
    nameEn: 'Rent',
    nameAr: 'إيجار',
  },
  {
    key: 'expense:salaries',
    type: 'expense',
    group: 5400,
    code: '5402',
    nameEn: 'Salaries and wages',
    nameAr: 'مرتبات وأجور',
  },
  {
    key: 'expense:fuel',
    type: 'expense',
    group: 5400,
    code: '5403',
    nameEn: 'Fuel and transport',
    nameAr: 'وقود ومواصلات',
  },
  {
    key: 'expense:packaging',
    type: 'expense',
    group: 5400,
    code: '5404',
    nameEn: 'Packaging and supplies',
    nameAr: 'تغليف ومستلزمات',
  },
  {
    key: 'expense:marketing',
    type: 'expense',
    group: 5400,
    code: '5405',
    nameEn: 'Marketing',
    nameAr: 'تسويق',
  },
  {
    key: 'expense:utilities',
    type: 'expense',
    group: 5400,
    code: '5406',
    nameEn: 'Utilities and internet',
    nameAr: 'مرافق وإنترنت',
  },
  {
    key: 'expense:maintenance',
    type: 'expense',
    group: 5400,
    code: '5407',
    nameEn: 'Maintenance',
    nameAr: 'صيانة',
  },
  {
    key: 'expense:government',
    type: 'expense',
    group: 5400,
    code: '5408',
    nameEn: 'Government fees',
    nameAr: 'رسوم حكومية',
  },
  {
    key: 'expense:other',
    type: 'expense',
    group: 5400,
    code: '5409',
    nameEn: 'Other expenses',
    nameAr: 'مصروفات أخرى',
  },
  {
    key: 'expense:bank_charges',
    type: 'expense',
    group: 5500,
    code: '5501',
    nameEn: 'Bank charges',
    nameAr: 'مصاريف بنكية',
  },
];

/** Where each kind of wallet sits in the chart, when it is opened automatically. */
const WALLET_GROUPS: Partial<Record<LedgerAccountType, { group: number; party: boolean }>> = {
  store_cash: { group: 1200, party: false },
  rider_cash: { group: 1300, party: true },
  merchant: { group: 2100, party: true },
  rider_bonus: { group: 2200, party: true },
  rider_dues: { group: 1350, party: true },
  staff_advance: { group: 1500, party: true },
  supplier: { group: 2500, party: true },
  merchant_deposit: { group: 2600, party: true },
  hub_safe: { group: 1250, party: true },
  courier_cash: { group: 1360, party: true },
  courier_wallet: { group: 2250, party: true },
  agent_payable: { group: 2270, party: true },
};

/**
 * The next free code of a group: 1102 after 1101, or 2100-0013 for a party wallet. Takes a
 * lock so two accounts opened at the same moment never get the same number.
 */
export async function nextAccountCode(tx: Tx, group: number, party: boolean) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ledger_account_code'))`;
  if (party) {
    const prefix = `${group}-`;
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(substr(code, 6) AS INTEGER)) AS max FROM ledger_accounts
      WHERE group_code = ${group} AND code LIKE ${prefix + '%'}`;
    const next = (rows[0]?.max ?? 0) + 1;
    if (next > 9999) throw new DomainError('group_full');
    return `${prefix}${String(next).padStart(4, '0')}`;
  }
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(code AS INTEGER)) AS max FROM ledger_accounts
    WHERE group_code = ${group} AND code ~ '^[0-9]+$'`;
  const next = Math.max(rows[0]?.max ?? group, group) + 1;
  if (next > group + 99) throw new DomainError('group_full');
  return String(next);
}

/** The next gapless serial number of a document table (taken inside its transaction). */
export async function nextNumber(
  tx: Tx,
  table:
    | 'ledger_entries'
    | 'payouts'
    | 'cash_handovers'
    | 'tickets'
    | 'bills'
    | 'bank_statements'
    | 'cheques'
    | 'purchase_orders'
    | 'crm_deals'
    | 'crm_proposals'
    | 'rider_withdrawals',
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'number:' + table}))`;
  const rows = await tx.$queryRawUnsafe<{ max: number | null }[]>(
    `SELECT MAX("number") AS max FROM "${table}"`,
  );
  return (rows[0]?.max ?? 0) + 1;
}

export function accountKey(ref: AccountRef): string {
  if ('id' in ref) throw new Error('accounts given by id have no key');
  switch (ref.type) {
    case 'merchant':
      return `merchant:${ref.merchantId}`;
    case 'rider_cash':
      return `rider_cash:${ref.riderId}`;
    case 'rider_bonus':
      return `rider_bonus:${ref.riderId}`;
    case 'rider_dues':
      return `rider_dues:${ref.riderId}`;
    case 'store_cash':
      return `store_cash:${ref.darkStoreId}`;
    case 'staff_advance':
      return `staff_advance:${ref.userId}`;
    case 'supplier':
      return `supplier:${ref.supplierId}`;
    case 'merchant_deposit':
      return `merchant_deposit:${ref.merchantId}`;
    case 'hub_safe':
      return `hub_safe:${ref.hubId}`;
    case 'courier_cash':
      return `courier_cash:${ref.userId}`;
    case 'courier_wallet':
      return `courier_wallet:${ref.userId}`;
    case 'agent_payable':
      return `agent_payable:${ref.agentId}`;
    default:
      return ref.type;
  }
}

/** The id of a system account (made the first time it is needed). */
export function systemAccountId(tx: Tx, type: SystemAccountKey) {
  return accountId(tx, { type } as AccountRef);
}

async function accountId(tx: Tx, ref: AccountRef): Promise<string> {
  if ('id' in ref) {
    const account = await tx.ledgerAccount.findUnique({ where: { id: ref.id } });
    if (!account) throw new DomainError('account_not_found', 404);
    if (!account.isActive) throw new DomainError('account_inactive');
    return account.id;
  }
  const key = accountKey(ref);
  const found = await tx.ledgerAccount.findUnique({ where: { key } });
  if (found) return found.id;
  const system = SYSTEM_ACCOUNTS[key as SystemAccountKey] as
    (typeof SYSTEM_ACCOUNTS)[SystemAccountKey] | undefined;
  const type = system?.type ?? (ref.type as LedgerAccountType);
  const wallet = WALLET_GROUPS[type];
  const group = system?.group ?? wallet!.group;
  let code = system?.code;
  if (!code || (await tx.ledgerAccount.findUnique({ where: { code } })))
    code = await nextAccountCode(tx, group, wallet?.party ?? false);
  const created = await tx.ledgerAccount.upsert({
    where: { key },
    update: {},
    create: {
      key,
      type,
      code,
      groupCode: group,
      category: CATEGORY[type],
      nameEn: system?.nameEn ?? null,
      nameAr: system?.nameAr ?? null,
      bankName: key === 'bank' ? 'CIB' : null,
      merchantId: 'merchantId' in ref ? ref.merchantId : null,
      riderId: 'riderId' in ref ? ref.riderId : null,
      darkStoreId: 'darkStoreId' in ref ? ref.darkStoreId : null,
      userId: 'userId' in ref ? ref.userId : null,
      supplierId: 'supplierId' in ref ? ref.supplierId : null,
      hubId: 'hubId' in ref ? ref.hubId : null,
      agentId: 'agentId' in ref ? ref.agentId : null,
    },
  });
  return created.id;
}

/** The accounting category of each kind of account. */
export const CATEGORY: Record<LedgerAccountType, AccountCategory> = {
  bank: 'asset',
  store_cash: 'asset',
  cash_box: 'asset',
  rider_cash: 'asset',
  rider_dues: 'asset',
  hub_safe: 'asset',
  courier_cash: 'asset',
  courier_wallet: 'liability',
  agent_payable: 'liability',
  other_asset: 'asset',
  staff_advance: 'asset',
  merchant: 'liability',
  supplier: 'liability',
  merchant_deposit: 'liability',
  rider_bonus: 'liability',
  vat_payable: 'liability',
  other_liability: 'liability',
  equity: 'equity',
  revenue: 'revenue',
  other_income: 'revenue',
  rider_bonus_expense: 'expense',
  damage_expense: 'expense',
  cash_difference: 'expense',
  expense: 'expense',
};

/** Creates the opening accounts that are missing (seed and tests; production has them). */
export async function ensureDefaultAccounts(db: Db) {
  await inTransaction(db, async (tx) => {
    await accountId(tx, { type: 'bank' });
    for (const a of DEFAULT_ACCOUNTS) {
      if (await tx.ledgerAccount.findUnique({ where: { key: a.key } })) continue;
      const taken = await tx.ledgerAccount.findUnique({ where: { code: a.code } });
      await tx.ledgerAccount.create({
        data: {
          key: a.key,
          type: a.type,
          code: taken ? await nextAccountCode(tx, a.group, false) : a.code,
          groupCode: a.group,
          category: CATEGORY[a.type],
          nameEn: a.nameEn,
          nameAr: a.nameAr,
        },
      });
    }
  });
}

export interface PostInput {
  kind: string;
  idempotencyKey: string;
  occurredAt?: Date;
  memo?: string;
  orderId?: string | null;
  data?: Prisma.InputJsonValue;
  createdById?: string | null;
  /** Where the whole entry counts; worked out from the order and wallets when left out. */
  darkStoreId?: string | null;
  merchantId?: string | null;
  riderId?: string | null;
  /** Parcel network place (sorting facility or hub) the entry counts for. */
  hubId?: string | null;
  /** The company of the group; worked out from the place when left out (Shiply Now by default). */
  company?: Company;
  /** Debit positive, credit negative. Lines of zero are dropped. A line's own tags win. */
  lines: { account: AccountRef; amount: number; tags?: LineTags }[];
}

/** Who and where a line counts for: profit per store, merchant, rider and team member. */
export interface LineTags {
  darkStoreId?: string | null;
  hubId?: string | null;
  merchantId?: string | null;
  riderId?: string | null;
  userId?: string | null;
}

/**
 * Refuses a moment inside a closed period (the books are closed through a Cairo day). The
 * database refuses it too; this check gives the clear books_closed answer first.
 */
export async function assertPeriodOpen(tx: Tx, at: Date) {
  const lock = await tx.booksLock.findUnique({ where: { id: 'books' } });
  if (lock && at < lock.lockedBefore) throw new DomainError('books_closed');
}

/**
 * Posts one balanced entry. The same idempotency key posts once: a repeat returns the
 * first entry, so jobs and retries are safe. Returns null when every line is zero.
 */
export async function post(db: Db, input: PostInput) {
  const lines = input.lines.filter((l) => l.amount !== 0);
  for (const l of lines)
    if (!Number.isSafeInteger(l.amount)) throw new DomainError('amount_not_integer', 400);
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total !== 0 || lines.length < 2) throw new Error(`unbalanced ledger entry ${input.kind}`);

  return inTransaction(db, async (tx) => {
    const seen = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (seen) return seen;
    const occurredAt = input.occurredAt ?? new Date();
    await assertPeriodOpen(tx, occurredAt);
    const entry = await tx.ledgerEntry.create({
      data: {
        number: await nextNumber(tx, 'ledger_entries'),
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        memo: input.memo,
        orderId: input.orderId ?? null,
        data: input.data,
        createdById: input.createdById ?? null,
      },
    });
    const ids: string[] = [];
    for (const line of lines) ids.push(await accountId(tx, line.account));
    const tags = await entryTags(tx, input, ids);
    for (const [i, line] of lines.entries()) {
      const darkStoreId = line.tags?.darkStoreId ?? tags.darkStoreId;
      const hubId = line.tags?.hubId ?? tags.hubId;
      // A parcel network place means the parcel company, unless the caller said otherwise.
      const company: Company = input.company ?? (hubId && !darkStoreId ? 'shiply' : 'shiply_now');
      await tx.ledgerLine.create({
        data: {
          entryId: entry.id,
          accountId: ids[i]!,
          amountPiastres: line.amount,
          occurredAt,
          darkStoreId,
          merchantId: line.tags?.merchantId ?? tags.merchantId,
          riderId: line.tags?.riderId ?? tags.riderId,
          userId: line.tags?.userId ?? null,
          company,
          hubId,
          costCenterId: await costCenterFor(tx, darkStoreId, hubId),
        },
      });
    }
    return entry;
  });
}

/**
 * Where an entry counts: what the caller says, then the order it belongs to, then the
 * wallets on its lines (a merchant, a rider, a store's cash box), then the rider's store.
 */
async function entryTags(tx: Tx, input: PostInput, accountIds: string[]) {
  const tags = {
    darkStoreId: input.darkStoreId ?? null,
    merchantId: input.merchantId ?? null,
    riderId: input.riderId ?? null,
    hubId: input.hubId ?? null,
  };
  if (input.orderId && (!tags.darkStoreId || !tags.merchantId)) {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { darkStoreId: true, merchantId: true },
    });
    tags.darkStoreId ??= order?.darkStoreId ?? null;
    tags.merchantId ??= order?.merchantId ?? null;
  }
  const owners = await tx.ledgerAccount.findMany({
    where: { id: { in: accountIds } },
    select: { merchantId: true, riderId: true, darkStoreId: true, hubId: true },
  });
  tags.hubId ??= owners.find((o) => o.hubId)?.hubId ?? null;
  tags.merchantId ??= owners.find((o) => o.merchantId)?.merchantId ?? null;
  tags.riderId ??= owners.find((o) => o.riderId)?.riderId ?? null;
  tags.darkStoreId ??= owners.find((o) => o.darkStoreId)?.darkStoreId ?? null;
  if (!tags.darkStoreId && tags.riderId) {
    const rider = await tx.rider.findUnique({
      where: { id: tags.riderId },
      select: { darkStoreId: true },
    });
    tags.darkStoreId = rider?.darkStoreId ?? null;
  }
  return tags;
}

/**
 * The cost center of a dark store or a parcel network place, made the first time it is used.
 * A store counts for Shiply Now; a facility or hub for Shiply.
 */
async function costCenterFor(tx: Tx, darkStoreId: string | null, hubId: string | null) {
  if (darkStoreId) {
    const found = await tx.costCenter.findUnique({ where: { darkStoreId } });
    if (found) return found.id;
    const store = await tx.darkStore.findUnique({
      where: { id: darkStoreId },
      select: { code: true, nameEn: true, nameAr: true },
    });
    if (!store) return null;
    const made = await tx.costCenter.upsert({
      where: { darkStoreId },
      update: {},
      create: {
        code: `DS-${store.code}`,
        nameEn: store.nameEn,
        nameAr: store.nameAr,
        company: 'shiply_now',
        darkStoreId,
      },
    });
    return made.id;
  }
  if (hubId) {
    const found = await tx.costCenter.findUnique({ where: { hubId } });
    if (found) return found.id;
    const hub = await tx.hub.findUnique({
      where: { id: hubId },
      select: { code: true, name: true },
    });
    if (!hub) return null;
    const made = await tx.costCenter.upsert({
      where: { hubId },
      update: {},
      create: {
        code: `NW-${hub.code}`,
        nameEn: hub.name,
        nameAr: hub.name,
        company: 'shiply',
        hubId,
      },
    });
    return made.id;
  }
  return null;
}

/** Debit minus credit of one account, optionally up to (not including) a moment. */
export async function balanceOf(db: Db, ref: AccountRef, before?: Date): Promise<number> {
  const result = await db.ledgerLine.aggregate({
    where: {
      account: 'id' in ref ? { id: ref.id } : { key: accountKey(ref) },
      occurredAt: before ? { lt: before } : undefined,
    },
    _sum: { amountPiastres: true },
  });
  return result._sum.amountPiastres ?? 0;
}

/** Balances of every account of the given types, keyed by account key. */
export async function balancesByType(db: Db, types: LedgerAccountType[]) {
  const accounts = await db.ledgerAccount.findMany({ where: { type: { in: types } } });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  return accounts.map((a) => ({
    ...a,
    balance: sums.find((s) => s.accountId === a.id)?._sum.amountPiastres ?? 0,
  }));
}

/** A share in basis points of an amount, rounded half up, in whole piastres. */
export function share(amount: number, basisPoints: number): number {
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}
