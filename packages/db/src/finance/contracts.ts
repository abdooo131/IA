import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  type ContractBody,
  type DepositBody,
  egpText,
  tierFor,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getMerchantSetting, getSetting } from '../settings';
import { addMonths } from './assets';
import { eventTime } from './books';
import { submitMovement } from './controls';
import { balanceOf, post, share } from './ledger';
import { bankAccount, merchantOwed } from './operations';
import { accrueStorage, lastClosedDay } from './postings';

type Tx = Prisma.TransactionClient;

// Merchant contracts on top of the fee settings:
//
// - Volume tiers: the order fee (fixed and share of products) follows the band of the
//   merchant's delivered orders in the Cairo month so far. The order that crosses into a band
//   pays the new band's fee and so does every later one; earlier orders are never charged
//   again (no rebate at month end). A tier value left empty falls back to the setting.
// - Monthly minimum: once a month is over, fees booked for it (before VAT) are topped up to
//   the minimum, shared out by the days the contract was in force (minimum_fee, once per
//   merchant and month).
// - Security deposit: held in the merchant's 2600 deposit wallet, received and paid back by
//   bank, by cheque or through the merchant's balance.
// - Credit limit: while the merchant owes us more than the limit, new shipments are refused
//   (merchant_over_credit_limit) and admin is alerted once a day.

const negate = (value: number) => 0 - value;
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const monthStart = (month: string) => cairoDayStart(`${month}-01`);

/** Whether a contract covers a Cairo day. */
const inForce = (c: { startDate: Date; endDate: Date | null }, day: string) =>
  dayText(c.startDate) <= day && (!c.endDate || dayText(c.endDate) >= day);

// ─── the contract ────────────────────────────────────────────────────────────────

/** The security deposit we hold for a merchant. */
export async function depositHeld(db: Db, merchantId: string) {
  return negate(await balanceOf(db, { type: 'merchant_deposit', merchantId }));
}

/** A merchant's contract, what we hold and owe, and where the month stands on the tiers. */
export async function getContract(db: Db, merchantId: string, now: Date = new Date()) {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, name: true },
  });
  if (!merchant) throw new DomainError('merchant_not_found', 404);
  const contract = await db.merchantContract.findUnique({
    where: { merchantId },
    include: { tiers: { orderBy: { fromOrder: 'asc' } }, updatedBy: { select: { name: true } } },
  });
  const today = cairoDay(now);
  const delivered = await db.order.count({
    where: {
      merchantId,
      status: 'delivered',
      deliveredAt: { gte: monthStart(today.slice(0, 7)), lte: now },
    },
  });
  const owed = await merchantOwed(db, merchantId);
  const tier = contract && inForce(contract, today) ? tierFor(contract.tiers, delivered + 1) : null;
  return {
    merchant,
    contract: contract
      ? {
          startDate: dayText(contract.startDate),
          endDate: contract.endDate ? dayText(contract.endDate) : null,
          noticeDays: contract.noticeDays,
          /** The last day to give notice to end it on its end date */
          noticeBy: contract.endDate
            ? addDays(dayText(contract.endDate), negate(contract.noticeDays))
            : null,
          minimumMonthlyFeePiastres: contract.minimumMonthlyFeePiastres,
          securityDepositPiastres: contract.securityDepositPiastres,
          creditLimitPiastres: contract.creditLimitPiastres,
          note: contract.note,
          tiers: contract.tiers.map((t) => ({
            fromOrder: t.fromOrder,
            fixedFeePiastres: t.fixedFeePiastres,
            percentBp: t.percentBp,
          })),
          inForce: inForce(contract, today),
          updatedAt: contract.updatedAt,
          updatedBy: contract.updatedBy.name,
        }
      : null,
    /** Fee settings for this merchant (their own value, else the global one) */
    settings: {
      orderFixedPiastres: await getMerchantSetting(db, 'fee.order_fixed_piastres', merchantId),
      orderPercentBp: await getMerchantSetting(db, 'fee.order_percent_bp', merchantId),
      codPercentBp: await getMerchantSetting(db, 'fee.cod_percent_bp', merchantId),
    },
    deliveredThisMonth: delivered,
    /** The band the next delivered order falls in */
    nextOrderTier: tier,
    depositHeldPiastres: await depositHeld(db, merchantId),
    owedPiastres: owed,
    overCreditLimit:
      contract?.creditLimitPiastres != null && owed < negate(contract.creditLimitPiastres),
  };
}

/** Saves a merchant's contract (merchants manage). Tiers are replaced as a whole; audited. */
export async function saveContract(
  db: Db,
  input: ContractBody & { merchantId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const before = await tx.merchantContract.findUnique({
      where: { merchantId: merchant.id },
      include: { tiers: { orderBy: { fromOrder: 'asc' } } },
    });
    const data = {
      startDate: dateOf(input.startDate),
      endDate: input.endDate ? dateOf(input.endDate) : null,
      noticeDays: input.noticeDays,
      minimumMonthlyFeePiastres: input.minimumMonthlyFeePiastres,
      securityDepositPiastres: input.securityDepositPiastres,
      creditLimitPiastres: input.creditLimitPiastres,
      note: input.note ?? null,
      updatedById: input.actorUserId,
    };
    const contract = await tx.merchantContract.upsert({
      where: { merchantId: merchant.id },
      create: { merchantId: merchant.id, ...data },
      update: data,
    });
    await tx.merchantContractTier.deleteMany({ where: { contractId: contract.id } });
    const tiers = [...input.tiers].sort((a, b) => a.fromOrder - b.fromOrder);
    if (tiers.length)
      await tx.merchantContractTier.createMany({
        data: tiers.map((t) => ({ contractId: contract.id, ...t })),
      });
    const view = (c: typeof data, t: typeof tiers) => ({
      startDate: dayText(c.startDate),
      endDate: c.endDate ? dayText(c.endDate) : null,
      noticeDays: c.noticeDays,
      minimum: c.minimumMonthlyFeePiastres,
      deposit: c.securityDepositPiastres,
      creditLimit: c.creditLimitPiastres,
      tiers: t
        .map((x) => `${x.fromOrder}+: ${x.fixedFeePiastres ?? '-'} / ${x.percentBp ?? '-'}bp`)
        .join(', '),
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: before ? 'merchant.contract_update' : 'merchant.contract_create',
      entityType: 'merchant_contract',
      entityId: merchant.id,
      before: before ? view(before, before.tiers) : undefined,
      after: view(data, tiers),
    });
    return contract;
  });
}

/** Every contract with what we hold and owe, for Accounting. */
export async function listContracts(db: Db, now: Date = new Date()) {
  const rows = await db.merchantContract.findMany({
    include: { merchant: { select: { id: true, name: true } }, tiers: true },
    orderBy: { merchant: { name: 'asc' } },
  });
  const today = cairoDay(now);
  const result = [];
  for (const c of rows) {
    const owed = await merchantOwed(db, c.merchantId);
    result.push({
      merchant: c.merchant,
      startDate: dayText(c.startDate),
      endDate: c.endDate ? dayText(c.endDate) : null,
      noticeBy: c.endDate ? addDays(dayText(c.endDate), negate(c.noticeDays)) : null,
      inForce: inForce(c, today),
      tiers: c.tiers.length,
      minimumMonthlyFeePiastres: c.minimumMonthlyFeePiastres,
      securityDepositPiastres: c.securityDepositPiastres,
      depositHeldPiastres: await depositHeld(db, c.merchantId),
      creditLimitPiastres: c.creditLimitPiastres,
      owedPiastres: owed,
      overCreditLimit: c.creditLimitPiastres != null && owed < negate(c.creditLimitPiastres),
    });
  }
  return result;
}

// ─── fees from the contract ──────────────────────────────────────────────────────

/**
 * The order fee values for a delivered order: the contract's band for the order's place
 * among the merchant's delivered orders of the Cairo month (this one included), else the
 * merchant's fee settings. Locks the merchant so two deliveries at once count in turn.
 */
export async function orderFeeTerms(
  tx: Tx,
  input: { merchantId: string; orderId: string; at: Date },
) {
  const fixedSetting = await getMerchantSetting(tx, 'fee.order_fixed_piastres', input.merchantId);
  const percentSetting = await getMerchantSetting(tx, 'fee.order_percent_bp', input.merchantId);
  const day = cairoDay(input.at);
  const contract = await tx.merchantContract.findUnique({
    where: { merchantId: input.merchantId },
    include: { tiers: true },
  });
  if (!contract || !contract.tiers.length || !inForce(contract, day))
    return { fixedPiastres: fixedSetting, percentBp: percentSetting, tierFrom: null, nth: null };
  await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
  const before = await tx.order.count({
    where: {
      merchantId: input.merchantId,
      status: 'delivered',
      deliveredAt: { gte: monthStart(day.slice(0, 7)), lte: input.at },
      id: { not: input.orderId },
    },
  });
  const nth = before + 1;
  const tier = tierFor(contract.tiers, nth);
  return {
    fixedPiastres: tier?.fixedFeePiastres ?? fixedSetting,
    percentBp: tier?.percentBp ?? percentSetting,
    tierFrom: tier?.fromOrder ?? null,
    nth,
  };
}

/**
 * Tops up last month's fees to each contract's minimum, once per merchant and month. The
 * minimum is shared out by the days the contract was in force in the month; fees counted are
 * every fee booked to the merchant for the month (before VAT). A month inside closed books is
 * skipped. On the first day after the month, the last day's storage is charged first.
 */
export async function chargeMinimumFees(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const month = addMonths(today.slice(0, 7), -1);
  const first = `${month}-01`;
  const last = addDays(`${today.slice(0, 7)}-01`, -1);
  if (lastClosedDay(now) === last) await accrueStorage(db, last);
  const from = monthStart(month);
  const to = cairoDayStart(addDays(last, 1));
  const daysInMonth = Number(last.slice(8, 10));
  const contracts = await db.merchantContract.findMany({
    where: { minimumMonthlyFeePiastres: { gt: 0 } },
  });
  let charged = 0;
  for (const c of contracts) {
    const start = dayText(c.startDate) > first ? dayText(c.startDate) : first;
    const end = c.endDate && dayText(c.endDate) < last ? dayText(c.endDate) : last;
    if (start > end) continue;
    const days = Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1;
    const minimum = Math.round((c.minimumMonthlyFeePiastres! * days) / daysInMonth);
    const fees = await feesBooked(db, c.merchantId, from, to);
    const topUp = minimum - fees;
    if (topUp <= 0) continue;
    const key = `minimum_fee:${c.merchantId}:${month}`;
    if (await db.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) continue;
    const lock = await db.booksLock.findUnique({ where: { id: 'books' } });
    const at = new Date(to.getTime() - 1);
    if (lock && at < lock.lockedBefore) continue;
    const vat = share(topUp, await getSetting(db, 'fee.vat_bp'));
    await post(db, {
      kind: 'minimum_fee',
      idempotencyKey: key,
      occurredAt: at,
      memo: `Minimum ${month}`,
      merchantId: c.merchantId,
      data: { month, minimumPiastres: minimum, feesPiastres: fees, days, daysInMonth },
      lines: [
        { account: { type: 'merchant', merchantId: c.merchantId }, amount: topUp + vat },
        { account: { type: 'revenue' }, amount: negate(topUp) },
        { account: { type: 'vat_payable' }, amount: negate(vat) },
      ],
    });
    charged++;
  }
  return { month, charged };
}

/** Fees (fee income, before VAT) booked to a merchant between two moments, minimum excluded. */
async function feesBooked(db: Db, merchantId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ fees: bigint | null }[]>`
    SELECT -SUM(l.amount_piastres) AS fees FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id
    WHERE a.type = 'revenue' AND l.merchant_id = ${merchantId}
      AND l.occurred_at >= ${from} AND l.occurred_at < ${to} AND e.kind <> 'minimum_fee'`;
  return Number(rows[0]?.fees ?? 0);
}

// ─── credit limit ────────────────────────────────────────────────────────────────

/**
 * Refuses new shipments while the merchant owes us more than the contract's credit limit,
 * raising one alert a day. Call it before the shipment's own transaction so the alert stays.
 */
export async function assertWithinCreditLimit(db: Db, merchantId: string, now: Date = new Date()) {
  const contract = await db.merchantContract.findUnique({
    where: { merchantId },
    include: { merchant: { select: { name: true } } },
  });
  if (!contract || contract.creditLimitPiastres == null) return;
  const owed = await merchantOwed(db, merchantId);
  if (owed >= negate(contract.creditLimitPiastres)) return;
  await db.alert.createMany({
    data: [
      {
        type: 'merchant_over_credit_limit',
        key: `credit_limit:${merchantId}:${cairoDay(now)}`,
        merchantId,
        data: {
          name: contract.merchant.name,
          owes: egpText(negate(owed)),
          limit: egpText(contract.creditLimitPiastres),
        },
      },
    ],
    skipDuplicates: true,
  });
  throw new DomainError('merchant_over_credit_limit', 409, {
    owesPiastres: negate(owed),
    limitPiastres: contract.creditLimitPiastres,
  });
}

// ─── security deposit ────────────────────────────────────────────────────────────

export interface DepositInput {
  merchantId: string;
  direction: 'in' | 'out';
  via: 'bank' | 'wallet';
  amountPiastres: number;
  bankAccountId?: string;
  reference: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * A security deposit received or paid back. By bank, the money comes in or leaves our bank;
 * through the wallet it is taken from (or added to) what we owe the merchant. Never more is
 * paid back than we hold, nor taken from a wallet that does not hold it.
 */
export function recordDeposit(db: Db, input: DepositInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `deposit:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${input.merchantId} FOR UPDATE`;
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const amount = input.amountPiastres;
    const deposit = { type: 'merchant_deposit' as const, merchantId: merchant.id };
    const wallet = { type: 'merchant' as const, merchantId: merchant.id };
    const other = input.via === 'bank' ? await bankAccount(tx, input.bankAccountId) : wallet;
    if (input.direction === 'out') {
      if (amount > (await depositHeld(tx, merchant.id))) throw new DomainError('more_than_deposit');
      if (input.via === 'bank' && amount > (await balanceOf(tx, other)))
        throw new DomainError('not_enough_money');
    } else if (input.via === 'wallet' && amount > (await merchantOwed(tx, merchant.id)))
      throw new DomainError('more_than_owed');
    const entry = (await post(tx, {
      kind: input.direction === 'in' ? 'deposit_received' : 'deposit_refunded',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: input.reference,
      merchantId: merchant.id,
      data: { via: input.via, reference: input.reference },
      lines:
        input.direction === 'in'
          ? [
              { account: other, amount },
              { account: deposit, amount: negate(amount) },
            ]
          : [
              { account: deposit, amount },
              { account: other, amount: negate(amount) },
            ],
    }))!;
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.direction === 'in' ? 'finance.deposit_in' : 'finance.deposit_out',
      entityType: 'merchant',
      entityId: merchant.id,
      after: { amount, via: input.via, reference: input.reference, entry: entry.number },
    });
    return entry;
  });
}

/**
 * Deposit received or paid back through the second person rule: money in (and any change to
 * the merchant's balance) always waits while finance.approve_money_in is on; a refund by bank
 * waits from the approval limit.
 */
export function submitDeposit(
  db: Db,
  input: DepositBody & { merchantId: string; actorUserId: string },
) {
  const { actorUserId, receiptPhotoId, ...rest } = input;
  return submitMovement(
    db,
    { kind: input.direction === 'in' ? 'deposit_in' : 'deposit_out', input: rest },
    actorUserId,
    receiptPhotoId,
  );
}
