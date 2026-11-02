import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { eventTime } from './books';
import { balanceOf, nextNumber, post } from './ledger';

type Tx = Prisma.TransactionClient;

// What we owe the people we buy from. A bill is booked when it arrives (the cost counts in
// its month even if we pay later), then paid in one or several payments:
//
//   bill:     Dr expense (net)   Dr VAT payable (VAT claimed back)   Cr supplier (total)
//   payment:  Dr supplier (paid) Cr bank or box (paid − withheld)    Cr withholding tax payable
//   tax paid: Dr VAT or withholding tax payable                      Cr bank or box
//
// Withholding tax (الخصم والإضافة) is a share of the amount before VAT, kept from each
// payment and paid to the tax authority every quarter with the supplier's tax id (form 41).

const MONEY_GROUPS = [1100, 1200];
const EXPENSE_GROUPS = [5400, 5500];

async function lockedAccount(tx: Tx, id: string, groups: number[], notFound: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_accounts WHERE id = ${id} FOR UPDATE`;
  const account = rows.length ? await tx.ledgerAccount.findUnique({ where: { id } }) : null;
  if (!account || !groups.includes(account.groupCode)) throw new DomainError(notFound, 404);
  if (!account.isActive) throw new DomainError('account_inactive');
  return account;
}

const validBp = (bp: number) => Number.isInteger(bp) && bp >= 0 && bp <= 10_000;

/** "48.75" EGP for one unit → 48,750,000 (rate × 1,000,000, exact). */
export function rateMicro(text: string) {
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new DomainError('invalid_rate', 400);
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'));
  if (micro <= 0) throw new DomainError('invalid_rate', 400);
  return micro;
}
/** Cents of a currency at a rate (× 1,000,000) to piastres, rounded half up. */
export const centsToPiastres = (cents: number, micro: number) =>
  Math.floor((cents * micro + 500_000) / 1_000_000);

// ─── suppliers ─────────────────────────────────────────────────────────────────

export interface SupplierInput {
  name: string;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  whtBp?: number;
  defaultExpenseAccountId?: string | null;
  actorUserId: string;
}

export function createSupplier(db: Db, input: SupplierInput) {
  if (input.whtBp !== undefined && !validBp(input.whtBp)) throw new DomainError('invalid_wht', 400);
  return inTransaction(db, async (tx) => {
    const same = await tx.supplier.findFirst({
      where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
    });
    if (same) throw new DomainError('supplier_exists');
    if (input.defaultExpenseAccountId)
      await lockedAccount(
        tx,
        input.defaultExpenseAccountId,
        EXPENSE_GROUPS,
        'expense_account_not_found',
      );
    const supplier = await tx.supplier.create({
      data: {
        name: input.name.trim(),
        taxId: input.taxId || null,
        phone: input.phone || null,
        email: input.email || null,
        whtBp: input.whtBp ?? 0,
        defaultExpenseAccountId: input.defaultExpenseAccountId || null,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.supplier_create',
      entityType: 'supplier',
      entityId: supplier.id,
      after: { name: supplier.name, taxId: supplier.taxId, whtBp: supplier.whtBp },
    });
    return supplier;
  });
}

export function updateSupplier(
  db: Db,
  input: Partial<Omit<SupplierInput, 'actorUserId'>> & {
    supplierId: string;
    isActive?: boolean;
    actorUserId: string;
  },
) {
  if (input.whtBp !== undefined && !validBp(input.whtBp)) throw new DomainError('invalid_wht', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!before) throw new DomainError('supplier_not_found', 404);
    if (input.name && input.name.trim().toLowerCase() !== before.name.toLowerCase()) {
      const same = await tx.supplier.findFirst({
        where: { name: { equals: input.name.trim(), mode: 'insensitive' } },
      });
      if (same) throw new DomainError('supplier_exists');
    }
    if (input.defaultExpenseAccountId)
      await lockedAccount(
        tx,
        input.defaultExpenseAccountId,
        EXPENSE_GROUPS,
        'expense_account_not_found',
      );
    const after = await tx.supplier.update({
      where: { id: before.id },
      data: {
        name: input.name?.trim() || undefined,
        taxId: input.taxId !== undefined ? input.taxId || null : undefined,
        phone: input.phone !== undefined ? input.phone || null : undefined,
        email: input.email !== undefined ? input.email || null : undefined,
        whtBp: input.whtBp,
        defaultExpenseAccountId:
          input.defaultExpenseAccountId !== undefined
            ? input.defaultExpenseAccountId || null
            : undefined,
        isActive: input.isActive,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.supplier_update',
      entityType: 'supplier',
      entityId: before.id,
      before: {
        name: before.name,
        taxId: before.taxId,
        whtBp: before.whtBp,
        isActive: before.isActive,
      },
      after: { name: after.name, taxId: after.taxId, whtBp: after.whtBp, isActive: after.isActive },
    });
    return after;
  });
}

/** Every supplier with what we owe them and how many bills are still open. */
export async function listSuppliers(db: Db) {
  const [suppliers, open] = await Promise.all([
    db.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        accounts: { select: { id: true, code: true } },
        staff: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
      },
    }),
    db.bill.groupBy({
      by: ['supplierId'],
      where: { status: 'open' },
      _count: { _all: true },
    }),
  ]);
  const ids = suppliers.flatMap((s) => s.accounts.map((a) => a.id));
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: ids } },
    _sum: { amountPiastres: true },
  });
  return suppliers.map((s) => {
    const account = s.accounts[0];
    const raw = account
      ? (sums.find((x) => x.accountId === account.id)?._sum.amountPiastres ?? 0)
      : 0;
    return {
      id: s.id,
      name: s.name,
      taxId: s.taxId,
      phone: s.phone,
      email: s.email,
      whtBp: s.whtBp,
      defaultExpenseAccountId: s.defaultExpenseAccountId,
      isActive: s.isActive,
      accountCode: account?.code ?? null,
      /** What we owe them (credit balance shown positive) */
      owedPiastres: 0 - raw,
      openBills: open.find((o) => o.supplierId === s.id)?._count._all ?? 0,
      /** People hired through this company (when it is an outsourcing company) */
      staff: s.staff,
    };
  });
}

// ─── bills ─────────────────────────────────────────────────────────────────────

export interface BillInput {
  supplierId: string;
  /** The supplier's own invoice number */
  reference: string;
  billDate: string;
  dueDate: string;
  expenseAccountId?: string;
  darkStoreId?: string | null;
  /** In EGP; for a bill in another currency it is worked out from the foreign amounts */
  netPiastres?: number;
  vatPiastres?: number;
  currency?: string;
  foreignNetCents?: number;
  foreignVatCents?: number;
  fxRate?: string;
  memo?: string;
  /** The person the bill is for: an outsourced worker's month from their outsourcing company */
  userId?: string | null;
  actorUserId: string;
  idempotencyKey: string;
}

/** A bill as it arrives: the cost and VAT now, the supplier owed until it is paid. */
export async function recordBill(db: Db, input: BillInput) {
  const foreign = input.currency && input.currency !== 'EGP';
  let fx: { currency: string; micro: number; total: number } | null = null;
  if (foreign) {
    if (!/^[A-Z]{3}$/.test(input.currency!)) throw new DomainError('invalid_currency', 400);
    const micro = rateMicro(input.fxRate ?? '');
    const fNet = input.foreignNetCents ?? 0;
    const fVat = input.foreignVatCents ?? 0;
    if (!Number.isSafeInteger(fNet) || fNet <= 0 || !Number.isSafeInteger(fVat) || fVat < 0)
      throw new DomainError('invalid_amount', 400);
    input = {
      ...input,
      netPiastres: centsToPiastres(fNet, micro),
      vatPiastres: centsToPiastres(fVat, micro),
    };
    fx = { currency: input.currency!, micro, total: fNet + fVat };
  }
  const net = input.netPiastres ?? 0;
  const vat = input.vatPiastres ?? 0;
  if (!Number.isSafeInteger(net) || net <= 0) throw new DomainError('invalid_amount', 400);
  if (!Number.isSafeInteger(vat) || vat < 0) throw new DomainError('invalid_vat', 400);
  if (!isCalendarDay(input.billDate) || !isCalendarDay(input.dueDate))
    throw new DomainError('invalid_date', 400);
  if (input.dueDate < input.billDate) throw new DomainError('due_before_bill', 400);
  const at = eventTime(input.billDate);
  return inTransaction(db, async (tx) => {
    const key = `bill:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return tx.bill.findFirstOrThrow({ where: { entryId: seen.id } });
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || !supplier.isActive) throw new DomainError('supplier_not_found', 404);
    const expenseId = input.expenseAccountId ?? supplier.defaultExpenseAccountId;
    if (!expenseId) throw new DomainError('expense_account_required', 400);
    const expense = await lockedAccount(tx, expenseId, EXPENSE_GROUPS, 'expense_account_not_found');
    let darkStoreId = input.darkStoreId ?? null;
    let person: { id: string; riderId: string | null } | null = null;
    if (input.userId) {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        include: { rider: { select: { id: true, darkStoreId: true } } },
      });
      if (!user || user.role === 'merchant') throw new DomainError('user_not_found', 404);
      // An outsourced person's month is billed by their own outsourcing company only.
      if (user.employment === 'outsourced' && user.staffingSupplierId !== supplier.id)
        throw new DomainError('not_their_company');
      darkStoreId ??= user.darkStoreId ?? user.rider?.darkStoreId ?? null;
      person = { id: user.id, riderId: user.rider?.id ?? null };
    }
    if (darkStoreId && !(await tx.darkStore.findUnique({ where: { id: darkStoreId } })))
      throw new DomainError('store_not_found', 404);
    const reference = input.reference.trim();
    if (
      await tx.bill.findFirst({
        where: { supplierId: supplier.id, reference, userId: person?.id ?? null },
      })
    )
      throw new DomainError('bill_exists');
    const total = net + vat;
    const entry = await post(tx, {
      kind: 'supplier_bill',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.memo || `${supplier.name} ${reference}`,
      darkStoreId,
      riderId: person?.riderId ?? null,
      data: { supplierId: supplier.id, reference, vat, userId: person?.id ?? null },
      lines: [
        {
          account: { id: expense.id },
          amount: net,
          tags: person ? { userId: person.id, darkStoreId, riderId: person.riderId } : undefined,
        },
        { account: { type: 'vat_payable' }, amount: vat },
        { account: { type: 'supplier', supplierId: supplier.id }, amount: -total },
      ],
    });
    const bill = await tx.bill.create({
      data: {
        number: await nextNumber(tx, 'bills'),
        supplierId: supplier.id,
        reference,
        billDate: new Date(`${input.billDate}T00:00:00Z`),
        dueDate: new Date(`${input.dueDate}T00:00:00Z`),
        expenseAccountId: expense.id,
        darkStoreId,
        userId: person?.id ?? null,
        netPiastres: net,
        vatPiastres: vat,
        totalPiastres: total,
        ...(fx
          ? { currency: fx.currency, fxRateMicro: BigInt(fx.micro), foreignTotal: fx.total }
          : {}),
        whtBp: supplier.whtBp,
        memo: input.memo || null,
        entryId: entry!.id,
        createdById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bill_create',
      entityType: 'bill',
      entityId: bill.id,
      after: { number: bill.number, supplier: supplier.name, reference, total, due: input.dueDate },
    });
    return bill;
  });
}

/** A bill entered by mistake, before any payment: reversed by a new entry. */
export function cancelBill(db: Db, input: { billId: string; reason: string; actorUserId: string }) {
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    const bill = await tx.bill.findUnique({ where: { id: input.billId } });
    if (!bill) throw new DomainError('bill_not_found', 404);
    if (bill.status !== 'open' || bill.paidPiastres > 0) throw new DomainError('bill_not_open');
    await post(tx, {
      kind: 'supplier_bill_cancel',
      idempotencyKey: `bill_cancel:${bill.id}`,
      createdById: input.actorUserId,
      memo: input.reason,
      darkStoreId: bill.darkStoreId,
      data: { billId: bill.id, supplierId: bill.supplierId, reason: input.reason },
      lines: [
        { account: { type: 'supplier', supplierId: bill.supplierId }, amount: bill.totalPiastres },
        { account: { id: bill.expenseAccountId }, amount: -bill.netPiastres },
        { account: { type: 'vat_payable' }, amount: -bill.vatPiastres },
      ],
    });
    const after = await tx.bill.update({ where: { id: bill.id }, data: { status: 'cancelled' } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bill_cancel',
      entityType: 'bill',
      entityId: bill.id,
      before: { status: bill.status },
      after: { status: 'cancelled', reason: input.reason },
    });
    return after;
  });
}

/** Withholding tax on the bill so far, given what has been paid of its total. */
const withheldAt = (
  bill: { netPiastres: number; totalPiastres: number; whtBp: number },
  paid: number,
) => Math.round((bill.netPiastres * bill.whtBp * paid) / (10_000 * bill.totalPiastres));

/** What a payment of this size keeps back as withholding tax (exact once the bill is paid). */
export function withholdingFor(
  bill: { netPiastres: number; totalPiastres: number; whtBp: number; paidPiastres: number },
  amount: number,
) {
  return withheldAt(bill, bill.paidPiastres + amount) - withheldAt(bill, bill.paidPiastres);
}

export interface BillPaymentInput {
  billId: string;
  /** How much of the bill this payment settles, withholding tax included (EGP bills) */
  amountPiastres?: number;
  /** A bill in another currency: how much of it is paid, in its cents, at today's rate */
  foreignAmountCents?: number;
  fxRate?: string;
  moneyAccountId: string;
  reference: string;
  /**
   * For an outsourced person's bill: an advance we gave them, taken back from what we pay
   * their company (the company takes it from their salary)
   */
  advanceRecoveryPiastres?: number;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Pays a bill (or part of it) from a bank or box, keeping back the withholding tax. */
export async function payBill(db: Db, input: BillPaymentInput) {
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `bill_payment:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    await tx.$executeRaw`SELECT id FROM bills WHERE id = ${input.billId} FOR UPDATE`;
    const bill = await tx.bill.findUnique({
      where: { id: input.billId },
      include: { supplier: true },
    });
    if (!bill) throw new DomainError('bill_not_found', 404);
    if (bill.status !== 'open') throw new DomainError('bill_not_open');
    // settled: how much of the bill (in EGP at the bill's rate) this payment clears;
    // paid: what it costs in EGP today. For a bill in another currency the two differ by
    // the change in the exchange rate.
    let settled: number;
    let paid: number;
    let foreignCents = 0;
    if (bill.currency === 'EGP') {
      settled = input.amountPiastres ?? 0;
      if (!Number.isSafeInteger(settled) || settled <= 0)
        throw new DomainError('invalid_amount', 400);
      if (settled > bill.totalPiastres - bill.paidPiastres) throw new DomainError('more_than_owed');
      paid = settled;
    } else {
      foreignCents = input.foreignAmountCents ?? 0;
      if (!Number.isSafeInteger(foreignCents) || foreignCents <= 0)
        throw new DomainError('invalid_amount', 400);
      const left = bill.foreignTotal! - bill.foreignPaid;
      if (foreignCents > left) throw new DomainError('more_than_owed');
      settled =
        foreignCents === left
          ? bill.totalPiastres - bill.paidPiastres
          : centsToPiastres(foreignCents, Number(bill.fxRateMicro));
      paid = centsToPiastres(foreignCents, rateMicro(input.fxRate ?? ''));
    }
    const fxDiff = paid - settled;
    const money = await lockedAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    const wht = withholdingFor(bill, settled);
    const recovery = input.advanceRecoveryPiastres ?? 0;
    if (!Number.isSafeInteger(recovery) || recovery < 0)
      throw new DomainError('invalid_amount', 400);
    if (recovery > 0) {
      if (!bill.userId) throw new DomainError('no_person_on_bill', 400);
      if (recovery > (await balanceOf(tx, { type: 'staff_advance', userId: bill.userId })))
        throw new DomainError('more_than_advance', 400);
    }
    const cash = paid - wht - recovery;
    if (cash < 0) throw new DomainError('net_below_zero', 400);
    if (cash > (await balanceOf(tx, { id: money.id }))) throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'bill_payment',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${bill.supplier.name} ${bill.reference}`,
      darkStoreId: bill.darkStoreId,
      data: {
        billId: bill.id,
        supplierId: bill.supplierId,
        reference: input.reference,
        gross: settled,
        wht,
        recovery,
        fxDiff,
        ...(foreignCents ? { currency: bill.currency, foreignCents, fxRate: input.fxRate } : {}),
        net: Math.round((bill.netPiastres * settled) / bill.totalPiastres),
      },
      lines: [
        {
          account: { type: 'supplier', supplierId: bill.supplierId },
          amount: settled,
        },
        { account: { type: 'fx_difference' }, amount: fxDiff },
        { account: { id: money.id }, amount: -cash },
        { account: { type: 'wht_payable' }, amount: -wht },
        ...(recovery
          ? [
              {
                account: { type: 'staff_advance' as const, userId: bill.userId! },
                amount: -recovery,
                tags: { userId: bill.userId },
              },
            ]
          : []),
      ],
    });
    const paidNow = bill.paidPiastres + settled;
    await tx.bill.update({
      where: { id: bill.id },
      data: {
        paidPiastres: paidNow,
        foreignPaid: bill.foreignPaid + foreignCents,
        status: paidNow === bill.totalPiastres ? 'paid' : 'open',
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.bill_payment',
      entityType: 'bill',
      entityId: bill.id,
      before: { paid: bill.paidPiastres },
      after: { paid: paidNow, wht, fxDiff, from: money.code, entry: entry!.number },
    });
    return entry!;
  });
}

/** Bills not fully paid, with what is left, sorted by due date. */
export async function listBills(
  db: Db,
  filter: { status?: 'open' | 'paid' | 'cancelled'; supplierId?: string } = {},
) {
  const bills = await db.bill.findMany({
    where: { status: filter.status, supplierId: filter.supplierId },
    include: {
      supplier: { select: { id: true, name: true } },
      expenseAccount: { select: { code: true, nameEn: true, nameAr: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      person: { select: { id: true, name: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    take: 500,
  });
  const today = cairoDay(new Date());
  return bills.map((b) => {
    const due = b.dueDate.toISOString().slice(0, 10);
    return {
      id: b.id,
      number: b.number,
      supplier: b.supplier,
      reference: b.reference,
      billDate: b.billDate.toISOString().slice(0, 10),
      dueDate: due,
      expenseAccount: b.expenseAccount,
      darkStore: b.darkStore,
      netPiastres: b.netPiastres,
      vatPiastres: b.vatPiastres,
      totalPiastres: b.totalPiastres,
      whtBp: b.whtBp,
      paidPiastres: b.paidPiastres,
      leftPiastres: b.status === 'open' ? b.totalPiastres - b.paidPiastres : 0,
      status: b.status,
      person: b.person,
      currency: b.currency,
      foreignTotalCents: b.foreignTotal,
      foreignLeftCents: b.foreignTotal === null ? null : b.foreignTotal - b.foreignPaid,
      fxRate: b.fxRateMicro === null ? null : Number(b.fxRateMicro) / 1_000_000,
      overdue: b.status === 'open' && due < today,
      memo: b.memo,
    };
  });
}

export const AGEING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;
type Bucket = (typeof AGEING_BUCKETS)[number];

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What is still owed per supplier by how late it is, on a Cairo day (today by default). */
export async function billAgeing(db: Db, asOf?: string) {
  const day = asOf ?? cairoDay(new Date());
  if (!isCalendarDay(day)) throw new DomainError('invalid_date', 400);
  const bills = await db.bill.findMany({
    where: { status: 'open', billDate: { lte: new Date(`${day}T00:00:00Z`) } },
    include: { supplier: { select: { id: true, name: true } } },
  });
  const empty = (): Record<Bucket, number> => ({
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    over_90: 0,
  });
  const rows = new Map<
    string,
    { supplier: { id: string; name: string }; buckets: Record<Bucket, number>; total: number }
  >();
  const total = empty();
  for (const b of bills) {
    const left = b.totalPiastres - b.paidPiastres;
    const late = daysBetween(b.dueDate.toISOString().slice(0, 10), day);
    const bucket: Bucket =
      late <= 0
        ? 'current'
        : late <= 30
          ? 'd1_30'
          : late <= 60
            ? 'd31_60'
            : late <= 90
              ? 'd61_90'
              : 'over_90';
    const row = rows.get(b.supplierId) ?? { supplier: b.supplier, buckets: empty(), total: 0 };
    row.buckets[bucket] += left;
    row.total += left;
    total[bucket] += left;
    rows.set(b.supplierId, row);
  }
  return {
    asOf: day,
    rows: [...rows.values()].sort((a, b) => b.total - a.total),
    total: { buckets: total, total: Object.values(total).reduce((s, v) => s + v, 0) },
  };
}

// ─── taxes ─────────────────────────────────────────────────────────────────────

/** The first moment of a quarter and of the next one, in Cairo time. */
function quarterRange(year: number, quarter: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || ![1, 2, 3, 4].includes(quarter))
    throw new DomainError('invalid_quarter', 400);
  const first = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const next =
    quarter === 4 ? `${year + 1}-01-01` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
  return { from: cairoDayStart(first), to: cairoDayStart(next), first, last: addDays(next, -1) };
}

/**
 * Withholding tax kept from suppliers in a quarter, per supplier with their tax id: what was
 * paid to them before VAT and what was withheld (the quarterly form 41 return).
 */
export async function whtReport(db: Db, input: { year: number; quarter: number }) {
  const range = quarterRange(input.year, input.quarter);
  const entries = await db.ledgerEntry.findMany({
    where: { kind: 'bill_payment', occurredAt: { gte: range.from, lt: range.to } },
    select: { data: true },
  });
  const suppliers = await db.supplier.findMany({ select: { id: true, name: true, taxId: true } });
  const rows = new Map<string, { netPiastres: number; whtPiastres: number; payments: number }>();
  for (const e of entries) {
    const d = e.data as { supplierId: string; net: number; wht: number };
    const row = rows.get(d.supplierId) ?? { netPiastres: 0, whtPiastres: 0, payments: 0 };
    row.netPiastres += d.net;
    row.whtPiastres += d.wht;
    row.payments += 1;
    rows.set(d.supplierId, row);
  }
  const list = [...rows.entries()]
    .map(([id, r]) => {
      const s = suppliers.find((x) => x.id === id);
      return { supplierId: id, name: s?.name ?? id, taxId: s?.taxId ?? null, ...r };
    })
    .sort((a, b) => b.whtPiastres - a.whtPiastres);
  return {
    year: input.year,
    quarter: input.quarter,
    from: range.first,
    to: range.last,
    rows: list,
    totalWhtPiastres: list.reduce((s, r) => s + r.whtPiastres, 0),
    missingTaxId: list.filter((r) => !r.taxId && r.whtPiastres > 0).length,
  };
}

export const TAXES = {
  vat: 'vat_payable',
  wht: 'wht_payable',
  payroll_tax: 'payroll_tax_payable',
  social_insurance: 'social_insurance_payable',
  martyrs_fund: 'martyrs_fund_payable',
  corporate_tax: 'corporate_tax_payable',
} as const;
export type TaxKind = keyof typeof TAXES;

/**
 * What we owe the state now: VAT (net of VAT claimed back), withholding tax, salary income
 * tax, social insurance (both shares) and the martyrs fund.
 */
export async function taxesOwed(db: Db) {
  const owed = async (tax: TaxKind) => 0 - (await balanceOf(db, { type: TAXES[tax] }));
  return {
    vatPiastres: await owed('vat'),
    whtPiastres: await owed('wht'),
    payrollTaxPiastres: await owed('payroll_tax'),
    socialInsurancePiastres: await owed('social_insurance'),
    martyrsFundPiastres: await owed('martyrs_fund'),
    corporateTaxPiastres: await owed('corporate_tax'),
  };
}

const TAX_NAMES: Record<TaxKind, string> = {
  vat: 'VAT',
  wht: 'Withholding tax',
  payroll_tax: 'Salary income tax',
  social_insurance: 'Social insurance',
  martyrs_fund: 'Martyrs fund',
  corporate_tax: 'Company income tax',
};

export interface TaxPaymentInput {
  tax: TaxKind;
  amountPiastres: number;
  moneyAccountId: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** VAT or withholding tax paid to the tax authority from a bank or box. */
export function payTax(db: Db, input: TaxPaymentInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  if (!(input.tax in TAXES)) throw new DomainError('invalid_tax', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `tax_payment:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    const money = await lockedAccount(tx, input.moneyAccountId, MONEY_GROUPS, 'account_not_found');
    const account = { type: TAXES[input.tax] };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax:' + input.tax}))`;
    const owed = 0 - (await balanceOf(tx, account));
    if (input.amountPiastres > owed) throw new DomainError('more_than_owed');
    if (input.amountPiastres > (await balanceOf(tx, { id: money.id })))
      throw new DomainError('not_enough_money');
    const entry = await post(tx, {
      kind: 'tax_payment',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${TAX_NAMES[input.tax]} ${input.reference}`,
      data: { tax: input.tax, reference: input.reference },
      lines: [
        { account, amount: input.amountPiastres },
        { account: { id: money.id }, amount: -input.amountPiastres },
      ],
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.tax_payment',
      entityType: 'ledger_entry',
      entityId: entry!.id,
      after: {
        tax: input.tax,
        amount: input.amountPiastres,
        from: money.code,
        ref: input.reference,
      },
    });
    return entry!;
  });
}
