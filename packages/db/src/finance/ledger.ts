import type { AccountCategory, LedgerAccountType, Prisma } from '@prisma/client';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';

type Tx = Prisma.TransactionClient;

/** Where money sits. Company accounts have no owner; wallets belong to one party. */
export type AccountRef =
  | { type: 'merchant'; merchantId: string }
  | { type: 'rider_cash'; riderId: string }
  | { type: 'rider_bonus'; riderId: string }
  | { type: 'store_cash'; darkStoreId: string }
  | {
      type:
        | 'bank'
        | 'revenue'
        | 'vat_payable'
        | 'rider_bonus_expense'
        | 'cash_difference'
        | 'damage_expense';
    }
  /** Any account by its id: banks, cash boxes, expense categories and the rest */
  | { id: string };

/** Accounts that exist once, with the code and name they take when first used. */
const SYSTEM_ACCOUNTS: Record<
  string,
  { type: LedgerAccountType; group: number; code: string; nameEn: string; nameAr: string }
> = {
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
    nameEn: 'Rider delivery bonuses',
    nameAr: 'حوافز توصيل المناديب',
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
  table: 'ledger_entries' | 'payouts' | 'cash_handovers' | 'tickets',
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
    case 'store_cash':
      return `store_cash:${ref.darkStoreId}`;
    default:
      return ref.type;
  }
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
  const system = SYSTEM_ACCOUNTS[key];
  const wallet = WALLET_GROUPS[ref.type];
  const group = system?.group ?? wallet!.group;
  let code = system?.code;
  if (!code || (await tx.ledgerAccount.findUnique({ where: { code } })))
    code = await nextAccountCode(tx, group, wallet?.party ?? false);
  const created = await tx.ledgerAccount.upsert({
    where: { key },
    update: {},
    create: {
      key,
      type: ref.type as LedgerAccountType,
      code,
      groupCode: group,
      category: CATEGORY[ref.type as LedgerAccountType],
      nameEn: system?.nameEn ?? null,
      nameAr: system?.nameAr ?? null,
      bankName: key === 'bank' ? 'CIB' : null,
      merchantId: 'merchantId' in ref ? ref.merchantId : null,
      riderId: 'riderId' in ref ? ref.riderId : null,
      darkStoreId: 'darkStoreId' in ref ? ref.darkStoreId : null,
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
  other_asset: 'asset',
  merchant: 'liability',
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
  /** Debit positive, credit negative. Lines of zero are dropped. */
  lines: { account: AccountRef; amount: number }[];
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
    for (const line of lines) {
      await tx.ledgerLine.create({
        data: {
          entryId: entry.id,
          accountId: await accountId(tx, line.account),
          amountPiastres: line.amount,
          occurredAt,
        },
      });
    }
    return entry;
  });
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
