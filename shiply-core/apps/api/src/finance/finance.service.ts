import { Injectable } from '@nestjs/common';
import type { Prisma } from '@shiply/db';
import { ACCOUNTS, applyBp, formatEgp, normalBalance, type PartyType } from '@shiply/shared';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { feesOf, settleable } from '../merchant/merchant.service';
import { partyBalances, post, rawBalance, type Line } from './ledger';
import { courierStanding, earn, paidByAgent } from './postings';

const MAX_FILE = 5 * 1024 * 1024;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-07');
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11');
const MONEY = z.number().int().min(1, 'Enter an amount').max(1_000_000_000);
const FILE = z.object({
  fileName: z.string().trim().min(1).max(160).default('file'),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(8),
});

const BankInput = z.object({
  bankName: z.string().trim().min(2).max(80),
  bankAccountName: z.string().trim().min(2).max(120),
  iban: z.string().transform((v) => v.replace(/\s+/g, '').toUpperCase()).pipe(z.string().regex(/^EG\d{27}$/, 'IBAN must be EG followed by 27 digits')),
});
const PayoutDaysInput = z.object({ payoutDays: z.array(z.number().int().min(0).max(6)).min(1).max(7) });
const ReferenceInput = z.object({ reference: z.string().trim().max(120).default('') });
const NoteInput = z.object({ note: z.string().trim().max(300).default('') });
const WithdrawInput = z.object({ amount: MONEY, method: z.string().trim().min(3, 'Say how you want to be paid, for example InstaPay 010...').max(120) });
const AdjustInput = z.object({
  kind: z.enum(['BONUS', 'PENALTY', 'ADJUSTMENT']),
  amount: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, 'Enter an amount'),
  note: z.string().trim().min(3, 'Write the reason').max(200),
});
const UnfreezeInput = z.object({ reason: z.string().trim().min(5, 'Write the reason').max(200), hours: z.number().int().min(1).max(72).default(24) });
const PayInInput = z.object({
  amount: MONEY,
  channel: z.enum(['FAWRY', 'BASATA', 'BANK_TRANSFER']).default('FAWRY'),
  purpose: z.enum(['CASH', 'RECHARGE']).default('CASH'),
  reference: z.string().trim().min(3, 'Enter the receipt or reference number').max(80),
  runId: z.string().uuid().nullish(),
  receipt: FILE,
});
const DepositInput = z.object({ amount: MONEY, reference: z.string().trim().min(3).max(80), receipt: FILE.nullish() });
const SettlementInput = z.object({ agentId: z.string().uuid(), month: MONTH });
const ExpenseInput = z.object({
  date: DATE,
  accountCode: z.string().trim().min(3).max(10),
  amount: MONEY,
  paidFrom: z.enum(['BANK', 'HUB_SAFE']).default('BANK'),
  hubId: z.string().uuid().nullish(),
  supplier: z.string().trim().max(120).default(''),
  note: z.string().trim().max(300).default(''),
  receipt: FILE.nullish(),
});
const AccountInput = z.object({
  code: z.string().trim().regex(/^[5-6]\d{3}$/, 'Expense accounts use a 4 digit code starting with 5 or 6'),
  name: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
});
const JournalInput = z.object({
  date: DATE,
  memo: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        account: z.string().trim().min(3).max(10),
        partyType: z.enum(['MERCHANT', 'COURIER', 'AGENT', 'HUB']).nullish(),
        partyId: z.string().uuid().nullish(),
        debit: z.number().int().min(0).default(0),
        credit: z.number().int().min(0).default(0),
        memo: z.string().trim().max(200).default(''),
      }),
    )
    .min(2)
    .max(50),
});
const CloseInput = z.object({ date: DATE });
const RangeInput = z.object({ from: DATE.optional(), to: DATE.optional() });

function decodeFile(f: z.infer<typeof FILE>) {
  const clean = f.dataBase64.includes(',') ? f.dataBase64.slice(f.dataBase64.indexOf(',') + 1) : f.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0) throw new DomainError('invalid_input', 'The file is empty', 422);
  if (buf.length > MAX_FILE) throw new DomainError('invalid_input', 'The file is larger than 5 MB', 422);
  return { data: new Uint8Array(buf), mime: f.mime, name: f.fileName };
}

/** The second person rule: whoever created a money request cannot approve it. */
function secondPerson(createdById: string | null | undefined, user: SessionUser) {
  if (createdById === user.id) throw new DomainError('same_person', 'Someone else must approve what you created', 403);
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Money: merchant payouts, courier wallets, pay ins, hub safes, agent settlements, expenses,
 * manual journals, closing the books, and the reports. Every movement posts to the ledger.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private audit(db: Tx | PrismaService, user: SessionUser, action: string, entity: string, entityId: string, data: unknown = {}) {
    return db.auditLog.create({ data: { userId: user.id, action, entity, entityId, data: JSON.parse(JSON.stringify(data)) } });
  }

  // ---------------------------------------------------------------- merchant bank details

  /** The first bank details apply at once; any change after that waits for a second person. */
  async setMerchantBank(merchantId: string, body: unknown, user: SessionUser) {
    const d = parse(BankInput, body);
    const m = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!m) throw notFound('Merchant');
    if (!m.iban) {
      await this.prisma.merchant.update({ where: { id: merchantId }, data: d });
      await this.audit(this.prisma, user, 'MERCHANT_BANK_SET', 'merchant', merchantId, { iban: d.iban.slice(-4) });
      return { status: 'SET' };
    }
    await this.prisma.merchant.update({ where: { id: merchantId }, data: { pendingBank: d, pendingBankById: user.id } });
    await this.audit(this.prisma, user, 'MERCHANT_BANK_CHANGE_REQUESTED', 'merchant', merchantId, { iban: d.iban.slice(-4) });
    return { status: 'PENDING_APPROVAL' };
  }

  async decideMerchantBank(merchantId: string, approve: boolean, user: SessionUser) {
    const m = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!m?.pendingBank) throw notFound('Bank change');
    secondPerson(m.pendingBankById, user);
    const d = BankInput.parse(m.pendingBank);
    await this.prisma.merchant.update({ where: { id: merchantId }, data: { ...(approve ? d : {}), pendingBank: null as never, pendingBankById: null } });
    await this.audit(this.prisma, user, approve ? 'MERCHANT_BANK_CHANGED' : 'MERCHANT_BANK_CHANGE_REJECTED', 'merchant', merchantId, { iban: d.iban.slice(-4) });
  }

  async setPayoutDays(merchantId: string, body: unknown, user: SessionUser) {
    const { payoutDays } = parse(PayoutDaysInput, body);
    await this.prisma.merchant.update({ where: { id: merchantId }, data: { payoutDays: [...new Set(payoutDays)].sort() } });
    await this.audit(this.prisma, user, 'MERCHANT_PAYOUT_DAYS', 'merchant', merchantId, { payoutDays });
  }

  // ---------------------------------------------------------------- merchant payouts

  /** Every merchant with money ready, whether today is one of their payout days, and their bank status. */
  async merchantBalances() {
    const s = await this.settings.all();
    const weekday = new Date(`${todayInCairo()}T12:00:00Z`).getUTCDay();
    const [merchants, ledger] = await Promise.all([
      this.prisma.merchant.findMany({ orderBy: { name: 'asc' } }),
      partyBalances(this.prisma, ACCOUNTS.MERCHANT_WALLET.code),
    ]);
    const out = [];
    for (const m of merchants) {
      const open = await settleable(this.prisma, m.id);
      const cod = open.reduce((n, x) => n + x.codCollected, 0);
      const fees = open.reduce((n, x) => n + feesOf(x), 0);
      const ready = cod - fees;
      out.push({
        merchantId: m.id, code: m.code, name: m.name, parcels: open.length, codTotal: cod, feesTotal: fees,
        ready, payoutFee: ready > 0 ? s['fees.payout_fee'] : 0, net: ready - (ready > 0 ? s['fees.payout_fee'] : 0),
        /** Everything the books say we owe the merchant, including cash still with couriers. */
        ledgerBalance: -(ledger.get(m.id) ?? 0),
        payoutDays: m.payoutDays, dueToday: m.payoutDays.includes(weekday), hasBank: !!m.iban, bankChangePending: !!m.pendingBank,
        bankName: m.bankName, iban: m.iban ? `•••• ${m.iban.slice(-4)}` : '',
      });
    }
    return out;
  }

  /** Puts everything ready for one merchant into a payout that a second person must approve. */
  async createPayout(merchantId: string, body: unknown, user: SessionUser) {
    const { reference } = parse(ReferenceInput, body ?? {});
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const m = await tx.merchant.findUnique({ where: { id: merchantId } });
      if (!m) throw notFound('Merchant');
      if (!m.iban) throw new DomainError('no_bank', `Add ${m.name}'s bank account first`, 422);
      if (m.pendingBank) throw new DomainError('bank_pending', 'A bank account change is waiting for approval. Approve or reject it first', 409);
      const open = await settleable(tx, merchantId);
      if (open.length === 0) throw new DomainError('invalid_input', 'Nothing to pay this merchant yet', 422);
      const codTotal = open.reduce((n, x) => n + x.codCollected, 0);
      const feesTotal = open.reduce((n, x) => n + feesOf(x), 0);
      const payoutFee = s['fees.payout_fee'];
      const amount = codTotal - feesTotal - payoutFee;
      if (amount <= 0) throw new DomainError('invalid_input', `Fees are more than the cash collected (${formatEgp(codTotal - feesTotal)}). Nothing to pay`, 422);
      const payout = await tx.payout.create({
        data: {
          code: await nextCode(tx, 'payout_seq', 'PO'), merchantId, codTotal, feesTotal, payoutFee, amount, reference,
          bankName: m.bankName, accountName: m.bankAccountName, iban: m.iban, createdById: user.id,
        },
      });
      const r = await tx.shipment.updateMany({ where: { id: { in: open.map((x) => x.id) }, payoutId: null }, data: { payoutId: payout.id } });
      if (r.count !== open.length) throw new DomainError('conflict', 'Someone paid some of these parcels just now. Try again', 409);
      await this.audit(tx, user, 'PAYOUT_CREATED', 'payout', payout.id, { merchantId, amount, parcels: open.length });
      return payout;
    });
  }

  /** Creates payouts for every merchant whose payout day is today and who has money ready. */
  async createDuePayouts(user: SessionUser) {
    const due = (await this.merchantBalances()).filter((m) => m.dueToday && m.hasBank && !m.bankChangePending && m.net > 0);
    const made: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const m of due) {
      try {
        made.push((await this.createPayout(m.merchantId, {}, user)).code);
      } catch (e) {
        skipped.push({ name: m.name, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    return { made, skipped };
  }

  payouts(status?: string) {
    const where: Prisma.PayoutWhereInput = status ? { status: status as never } : {};
    return this.prisma.payout.findMany({ where, include: { merchant: { select: { name: true, code: true } }, _count: { select: { shipments: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async approvePayout(id: string, user: SessionUser) {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p) throw notFound('Payout');
    secondPerson(p.createdById, user);
    const r = await this.prisma.payout.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
    if (r.count !== 1) throw new DomainError('bad_status', 'This payout is not waiting for approval', 409);
    await this.audit(this.prisma, user, 'PAYOUT_APPROVED', 'payout', id);
  }

  async cancelPayout(id: string, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const r = await tx.payout.updateMany({ where: { id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
      if (r.count !== 1) throw new DomainError('bad_status', 'Only a payout that is not paid yet can be cancelled', 409);
      await tx.shipment.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
      await this.audit(tx, user, 'PAYOUT_CANCELLED', 'payout', id);
    });
  }

  /** The bank sent the money: the merchant's balance goes down, the bank goes down, we keep the fee. */
  async payPayout(id: string, body: unknown, user: SessionUser) {
    const { reference } = parse(ReferenceInput, body ?? {});
    await this.prisma.tx(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id }, include: { merchant: true } });
      if (!p) throw notFound('Payout');
      const r = await tx.payout.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAID', paidAt: new Date(), paidById: user.id, ...(reference ? { reference } : {}) } });
      if (r.count !== 1) throw new DomainError('bad_status', 'Approve the payout before marking it paid', 409);
      await post(tx, {
        memo: `Payout ${p.code} to ${p.merchant.name}`,
        source: 'PAYOUT',
        key: `PAYOUT:${p.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.MERCHANT_WALLET.code, party: { type: 'MERCHANT', id: p.merchantId }, debit: p.amount + p.payoutFee },
          { account: ACCOUNTS.BANK.code, credit: p.amount, memo: reference || p.reference },
          { account: ACCOUNTS.PAYOUT_FEE_REVENUE.code, credit: p.payoutFee },
        ],
      });
      await this.audit(tx, user, 'PAYOUT_PAID', 'payout', id, { amount: p.amount });
    });
  }

  /** A bulk transfer file for the bank (CIB layout): approved merchant payouts and agent settlements. */
  async bankFile() {
    const [payouts, settlements] = await Promise.all([
      this.prisma.payout.findMany({ where: { status: 'APPROVED' }, include: { merchant: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.agentSettlement.findMany({ where: { status: 'APPROVED', total: { gt: 0 } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const agents = new Map((await this.prisma.agent.findMany({ where: { id: { in: settlements.map((x) => x.agentId) } } })).map((a) => [a.id, a]));
    const rows: (string | number)[][] = [['Beneficiary Name', 'Beneficiary Account (IBAN)', 'Bank', 'Amount', 'Currency', 'Reference']];
    for (const p of payouts) rows.push([p.accountName || p.merchant.name, p.iban, p.bankName, (p.amount / 100).toFixed(2), 'EGP', p.code]);
    for (const x of settlements) {
      const a = agents.get(x.agentId);
      if (!a?.iban) continue;
      rows.push([a.bankAccountName || a.name, a.iban, a.bankName, (x.total / 100).toFixed(2), 'EGP', x.code]);
    }
    return { csv: rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', count: rows.length - 1 };
  }

  // ---------------------------------------------------------------- courier wallets

  async couriers() {
    const s = await this.settings.all();
    const [users, wallets, cash] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'COURIER' }, select: { id: true, name: true, phone: true, courierType: true, agentId: true, unfreezeUntil: true, hub: { select: { code: true } }, agent: { select: { name: true } } }, orderBy: { name: 'asc' } }),
      partyBalances(this.prisma, ACCOUNTS.COURIER_WALLET.code),
      partyBalances(this.prisma, ACCOUNTS.COURIER_CASH.code),
    ]);
    const now = new Date();
    return users.map((u) => {
      const wallet = -(wallets.get(u.id) ?? 0);
      return {
        id: u.id, name: u.name, phone: u.phone, courierType: u.courierType, hub: u.hub?.code ?? '', agent: u.agent?.name ?? '',
        wallet, cashToHandIn: cash.get(u.id) ?? 0, paidByAgent: paidByAgent(u, s),
        frozen: wallet < 0 && !(u.unfreezeUntil && u.unfreezeUntil > now),
      };
    });
  }

  async courierWallet(courierId: string) {
    const s = await this.settings.all();
    const u = await this.prisma.user.findUnique({ where: { id: courierId }, select: { id: true, name: true, role: true } });
    if (!u || u.role !== 'COURIER') throw notFound('Courier');
    const [standing, earnings, withdrawals, payIns] = await Promise.all([
      courierStanding(this.prisma, s, courierId),
      this.prisma.courierEarning.findMany({ where: { courierId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.withdrawal.findMany({ where: { courierId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.payIn.findMany({ where: { courierId }, omit: { receipt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { courier: { id: u.id, name: u.name }, ...standing, pointValue: s['pay.point_value'], freezeDays: s['pay.freeze_days'], earnings, withdrawals, payIns };
  }

  async requestWithdrawal(user: SessionUser, body: unknown) {
    const d = parse(WithdrawInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const st = await courierStanding(tx, s, user.id);
      if (st.paidByAgent) throw new DomainError('paid_by_agent', 'Your agent pays you. Your earnings go to your agent at month end', 409);
      const open = await tx.withdrawal.findFirst({ where: { courierId: user.id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } });
      if (open) throw new DomainError('duplicate', `You already have request ${open.code} waiting`, 409);
      if (d.amount > st.withdrawable) throw new DomainError('too_much', `You can withdraw up to ${formatEgp(st.withdrawable)} now`, 422);
      const w = await tx.withdrawal.create({ data: { code: await nextCode(tx, 'money_seq', 'WD'), courierId: user.id, amount: d.amount, method: d.method, requestedById: user.id } });
      return w;
    });
  }

  withdrawals(status?: string) {
    return this.prisma.withdrawal.findMany({ where: status ? { status: status as never } : {}, orderBy: { createdAt: 'desc' }, take: 200 }).then(async (rows) => {
      const names = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.courierId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return rows.map((r) => ({ ...r, courierName: names.get(r.courierId) ?? '' }));
    });
  }

  async decideWithdrawal(id: string, approve: boolean, body: unknown, user: SessionUser) {
    const { note } = parse(NoteInput, body ?? {});
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw notFound('Withdrawal');
    secondPerson(w.requestedById, user);
    const r = await this.prisma.withdrawal.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id, note } });
    if (r.count !== 1) throw new DomainError('bad_status', 'This request is not waiting for approval', 409);
    await this.audit(this.prisma, user, approve ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED', 'withdrawal', id, { note });
  }

  async payWithdrawal(id: string, user: SessionUser) {
    const s = await this.settings.all();
    await this.prisma.tx(async (tx) => {
      const w = await tx.withdrawal.findUnique({ where: { id } });
      if (!w || w.status !== 'APPROVED') throw new DomainError('bad_status', 'Approve the request before paying it', 409);
      // Check again at payment time: the wallet may have changed since the request.
      const st = await courierStanding(tx, s, w.courierId);
      if (w.amount > st.withdrawable) throw new DomainError('too_much', `The courier can only withdraw ${formatEgp(st.withdrawable)} now`, 409);
      await tx.withdrawal.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Withdrawal ${w.code}`,
        source: 'WITHDRAWAL',
        key: `WITHDRAWAL:${w.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.COURIER_WALLET.code, party: { type: 'COURIER', id: w.courierId }, debit: w.amount },
          { account: ACCOUNTS.BANK.code, credit: w.amount, memo: w.method },
        ],
      });
      await this.audit(tx, user, 'WITHDRAWAL_PAID', 'withdrawal', id, { amount: w.amount });
    });
  }

  /** Bonus, penalty or correction on a courier's wallet, with a reason. */
  async adjustCourier(courierId: string, body: unknown, user: SessionUser) {
    const d = parse(AdjustInput, body);
    if (d.kind === 'BONUS' && d.amount < 0) throw new DomainError('invalid_input', 'A bonus is a positive amount', 422);
    if (d.kind === 'PENALTY' && d.amount > 0) throw new DomainError('invalid_input', 'A penalty is a negative amount', 422);
    const s = await this.settings.all();
    const c = await this.prisma.user.findFirst({ where: { id: courierId, role: 'COURIER' } });
    if (!c) throw notFound('Courier');
    return this.prisma.tx(async (tx) => {
      const e = await earn(tx, s, { courierId, kind: d.kind, amount: d.amount, note: d.note, userId: user.id });
      await this.audit(tx, user, 'COURIER_ADJUSTED', 'user', courierId, d);
      return e;
    });
  }

  /** Lets a courier with a negative wallet work for a while. Always with a reason, always audited. */
  async unfreeze(courierId: string, body: unknown, user: SessionUser) {
    const d = parse(UnfreezeInput, body);
    const until = new Date(Date.now() + d.hours * 3600 * 1000);
    const r = await this.prisma.user.updateMany({ where: { id: courierId, role: 'COURIER' }, data: { unfreezeUntil: until, unfreezeReason: d.reason } });
    if (r.count !== 1) throw notFound('Courier');
    await this.audit(this.prisma, user, 'COURIER_UNFROZEN', 'user', courierId, d);
    return { unfreezeUntil: until };
  }

  // ---------------------------------------------------------------- pay ins (Fawry receipts)

  async submitPayIn(user: SessionUser, body: unknown) {
    const d = parse(PayInInput, body);
    const file = decodeFile(d.receipt);
    if (d.runId) {
      const run = await this.prisma.run.findFirst({ where: { id: d.runId, courierId: user.id } });
      if (!run) throw new DomainError('invalid_input', 'Pick one of your own runs', 422);
    }
    return this.prisma.tx(async (tx) => {
      const p = await tx.payIn.create({
        data: { code: await nextCode(tx, 'money_seq', 'PI'), courierId: user.id, runId: d.runId ?? null, amount: d.amount, channel: d.channel, purpose: d.purpose, reference: d.reference, receipt: file.data, receiptMime: file.mime },
        omit: { receipt: true },
      });
      return p;
    });
  }

  payIns(status?: string) {
    return this.prisma.payIn.findMany({ where: status ? { status: status as never } : {}, omit: { receipt: true }, orderBy: { createdAt: 'desc' }, take: 200 }).then(async (rows) => {
      const names = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.courierId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return rows.map((r) => ({ ...r, courierName: names.get(r.courierId) ?? '' }));
    });
  }

  async payInReceipt(id: string, courierId?: string) {
    const p = await this.prisma.payIn.findUnique({ where: { id }, select: { receipt: true, receiptMime: true, code: true, courierId: true } });
    if (!p?.receipt || (courierId && p.courierId !== courierId)) throw notFound('Receipt');
    return { data: p.receipt, mime: p.receiptMime, name: `${p.code}` };
  }

  /**
   * Finance saw the money in the bank. Cash paid in for a run that is still open lowers the cash
   * the courier owes; anything else (a recharge, or cash for a run already closed short) goes
   * into the wallet.
   */
  async decidePayIn(id: string, approve: boolean, body: unknown, user: SessionUser) {
    const { note } = parse(NoteInput, body ?? {});
    await this.prisma.tx(async (tx) => {
      const p = await tx.payIn.findUnique({ where: { id }, omit: { receipt: true } });
      if (!p) throw notFound('Pay in');
      secondPerson(p.courierId, user);
      const r = await tx.payIn.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: approve ? 'CONFIRMED' : 'REJECTED', checkedById: user.id, checkedAt: new Date(), note } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This pay in was already checked', 409);
      if (approve) {
        const run = p.runId ? await tx.run.findUnique({ where: { id: p.runId } }) : null;
        const toCash = p.purpose === 'CASH' && (!run || run.status !== 'CLOSED');
        const cashOwed = await rawBalance(tx, ACCOUNTS.COURIER_CASH.code, { type: 'COURIER', id: p.courierId });
        const cashPart = toCash ? Math.min(p.amount, Math.max(0, cashOwed)) : 0;
        await post(tx, {
          memo: `Pay in ${p.code} (${p.channel.toLowerCase()} ${p.reference})`,
          source: 'PAY_IN',
          key: `PAY_IN:${p.id}`,
          userId: user.id,
          lines: [
            { account: ACCOUNTS.BANK.code, debit: cashPart },
            { account: ACCOUNTS.COURIER_CASH.code, party: { type: 'COURIER', id: p.courierId }, credit: cashPart },
          ],
        });
        // The rest goes into the wallet as an entry the agent settlement sees, so a shortage the
        // courier repaid is not charged to the agent too.
        if (p.amount - cashPart > 0) {
          await earn(tx, await this.settings.all(tx), {
            courierId: p.courierId, kind: 'ADJUSTMENT', amount: p.amount - cashPart, note: `${p.purpose === 'RECHARGE' ? 'Recharge' : 'Cash paid in'} ${p.code}`, userId: user.id,
            contra: { account: ACCOUNTS.BANK.code },
          });
        }
      }
      await this.audit(tx, user, approve ? 'PAY_IN_CONFIRMED' : 'PAY_IN_REJECTED', 'pay_in', id, { amount: p.amount, note });
    });
  }

  // ---------------------------------------------------------------- hub safes and bank deposits

  async safe(hubId: string) {
    const [balance, deposits] = await Promise.all([
      rawBalance(this.prisma, ACCOUNTS.HUB_SAFE.code, { type: 'HUB', id: hubId }),
      this.prisma.safeDeposit.findMany({ where: { hubId }, omit: { receipt: true }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    const waiting = deposits.filter((d) => d.status === 'SUBMITTED').reduce((n, d) => n + d.amount, 0);
    return { balance, waitingDeposits: waiting, available: balance - waiting, deposits };
  }

  async createDeposit(hubId: string, body: unknown, user: SessionUser) {
    const d = parse(DepositInput, body);
    const file = d.receipt ? decodeFile(d.receipt) : null;
    const safe = await this.safe(hubId);
    if (d.amount > safe.available) throw new DomainError('too_much', `The safe has ${formatEgp(safe.available)} not yet deposited`, 422);
    return this.prisma.tx(async (tx) =>
      tx.safeDeposit.create({
        data: { code: await nextCode(tx, 'money_seq', 'DP'), hubId, amount: d.amount, reference: d.reference, receipt: file?.data ?? null, receiptMime: file?.mime ?? '', createdById: user.id },
        omit: { receipt: true },
      }),
    );
  }

  async deposits(status?: string) {
    const rows = await this.prisma.safeDeposit.findMany({ where: status ? { status: status as never } : {}, omit: { receipt: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const hubs = new Map((await this.prisma.hub.findMany({ select: { id: true, code: true, name: true } })).map((h) => [h.id, h]));
    return rows.map((r) => ({ ...r, hub: hubs.get(r.hubId) ?? null }));
  }

  async depositReceipt(id: string) {
    const d = await this.prisma.safeDeposit.findUnique({ where: { id }, select: { receipt: true, receiptMime: true, code: true } });
    if (!d?.receipt) throw notFound('Receipt');
    return { data: d.receipt, mime: d.receiptMime, name: d.code };
  }

  async decideDeposit(id: string, approve: boolean, body: unknown, user: SessionUser) {
    const { note } = parse(NoteInput, body ?? {});
    await this.prisma.tx(async (tx) => {
      const d = await tx.safeDeposit.findUnique({ where: { id }, omit: { receipt: true } });
      if (!d) throw notFound('Deposit');
      secondPerson(d.createdById, user);
      const r = await tx.safeDeposit.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: approve ? 'CONFIRMED' : 'REJECTED', checkedById: user.id, checkedAt: new Date(), note } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This deposit was already checked', 409);
      if (approve) {
        await post(tx, {
          memo: `Deposit ${d.code} from hub safe (${d.reference})`,
          source: 'SAFE_DEPOSIT',
          key: `SAFE_DEPOSIT:${d.id}`,
          userId: user.id,
          lines: [
            { account: ACCOUNTS.BANK.code, debit: d.amount },
            { account: ACCOUNTS.HUB_SAFE.code, party: { type: 'HUB', id: d.hubId }, credit: d.amount },
          ],
        });
      }
      await this.audit(tx, user, approve ? 'DEPOSIT_CONFIRMED' : 'DEPOSIT_REJECTED', 'safe_deposit', id, { amount: d.amount, note });
    });
  }

  // ---------------------------------------------------------------- agent month end

  /** What an agent is owed for a month, worked out from the records, before anything is posted. */
  async computeSettlement(db: Tx | PrismaService, agentId: string, month: string) {
    const s = await this.settings.all(db);
    const agent = await db.agent.findUnique({ where: { id: agentId }, include: { vehicles: { where: { active: true, contract: 'FIXED' } } } });
    if (!agent) throw notFound('Agent');
    const { from, to } = monthRange(month);
    const staff = await db.user.findMany({ where: { agentId, role: 'COURIER' }, select: { id: true, name: true, agentId: true, courierType: true } });
    const viaAgent = staff.filter((u) => paidByAgent(u, s));
    const earnings = await db.courierEarning.findMany({ where: { agentId, courierId: { in: viaAgent.map((u) => u.id) }, date: { gte: from, lte: to }, settlementId: null } });
    const WORK = new Set(['DELIVERY', 'RETURN', 'PICKUP', 'BONUS']);
    const perStaff = viaAgent
      .map((u) => {
        const mine = earnings.filter((e) => e.courierId === u.id);
        return {
          courierId: u.id,
          name: u.name,
          /** Pay for work: commission is charged on this. */
          work: mine.filter((e) => WORK.has(e.kind)).reduce((n, e) => n + e.amount, 0),
          /** Shortages, penalties, recharges and corrections. */
          other: mine.filter((e) => !WORK.has(e.kind)).reduce((n, e) => n + e.amount, 0),
          parcels: mine.filter((e) => e.kind === 'DELIVERY' || e.kind === 'RETURN' || e.kind === 'PICKUP').length,
        };
      })
      .filter((x) => x.work !== 0 || x.other !== 0);
    const earned = perStaff.reduce((n, x) => n + x.work, 0);
    const deducted = perStaff.reduce((n, x) => n + x.other, 0);
    const commissionBp = agent.commissionBp ?? s['agents.default_commission_bp'];
    const commission = applyBp(earned, commissionBp);
    const vehicles = agent.vehicles.map((v) => ({ id: v.id, plate: v.plate, rent: v.monthlyRent }));
    const vehicleRent = vehicles.reduce((n, v) => n + v.rent, 0);
    const special = await db.vehicleRequest.findMany({ where: { agentId, status: 'DONE', date: { gte: from, lte: to } }, select: { id: true, code: true, date: true, price: true } });
    const specialVehicles = special.reduce((n, r) => n + r.price, 0);
    const overdue = await db.shift.findMany({ where: { agentId, replacementOverdue: true, date: { gte: from, lte: to } }, select: { id: true, date: true } });
    const penalties = overdue.length * s['attendance.replacement_penalty'];
    const staffPay = earned + deducted;
    return {
      agent: { id: agent.id, name: agent.name, code: agent.code },
      month, staffPay, commissionBp, commission, vehicleRent, specialVehicles, penalties,
      total: staffPay + commission + vehicleRent + specialVehicles - penalties,
      details: { perStaff, vehicles, special, overdueReplacements: overdue.length, penaltyEach: s['attendance.replacement_penalty'], earningIds: earnings.map((e) => e.id) },
    };
  }

  previewSettlement(query: unknown) {
    const d = parse(SettlementInput, query);
    return this.computeSettlement(this.prisma, d.agentId, d.month);
  }

  async createSettlement(body: unknown, user: SessionUser) {
    const d = parse(SettlementInput, body);
    if (d.month >= todayInCairo().slice(0, 7)) throw new DomainError('invalid_input', 'Settle a month after it ends', 422);
    return this.prisma.tx(async (tx) => {
      const exists = await tx.agentSettlement.findUnique({ where: { agentId_month: { agentId: d.agentId, month: d.month } } });
      if (exists && exists.status !== 'REJECTED') throw new DomainError('duplicate', `This month is already in settlement ${exists.code}`, 409);
      if (exists) await tx.agentSettlement.delete({ where: { id: exists.id } });
      const c = await this.computeSettlement(tx, d.agentId, d.month);
      const x = await tx.agentSettlement.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'AS'), agentId: d.agentId, month: d.month, staffPay: c.staffPay, commissionBp: c.commissionBp, commission: c.commission,
          vehicleRent: c.vehicleRent, specialVehicles: c.specialVehicles, penalties: c.penalties, total: c.total, details: c.details as never, createdById: user.id,
        },
        omit: { invoice: true },
      });
      await this.audit(tx, user, 'SETTLEMENT_CREATED', 'agent_settlement', x.id, { total: c.total });
      return x;
    });
  }

  async settlements(agentId?: string) {
    const rows = await this.prisma.agentSettlement.findMany({ where: agentId ? { agentId } : {}, omit: { invoice: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const agents = new Map((await this.prisma.agent.findMany({ select: { id: true, name: true, code: true } })).map((a) => [a.id, a]));
    return rows.map((r) => ({ ...r, agent: agents.get(r.agentId) ?? null, hasInvoice: !!r.invoiceName }));
  }

  async uploadInvoice(id: string, body: unknown, user: SessionUser, agentId?: string) {
    const f = decodeFile(parse(FILE, body));
    const r = await this.prisma.agentSettlement.updateMany({ where: { id, ...(agentId ? { agentId } : {}), status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, data: { invoice: f.data, invoiceMime: f.mime, invoiceName: f.name } });
    if (r.count !== 1) throw notFound('Open settlement');
    await this.audit(this.prisma, user, 'SETTLEMENT_INVOICE', 'agent_settlement', id, { name: f.name });
  }

  async invoice(id: string, agentId?: string) {
    const x = await this.prisma.agentSettlement.findUnique({ where: { id }, select: { invoice: true, invoiceMime: true, invoiceName: true, agentId: true } });
    if (!x?.invoice || (agentId && x.agentId !== agentId)) throw notFound('Invoice');
    return { data: x.invoice, mime: x.invoiceMime, name: x.invoiceName };
  }

  /**
   * Approving books the month: staff wallets move to the agent, and commission, vehicles and
   * penalties are recorded against the agent.
   */
  async approveSettlement(id: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const x = await tx.agentSettlement.findUnique({ where: { id }, omit: { invoice: true } });
      if (!x) throw notFound('Settlement');
      secondPerson(x.createdById, user);
      const r = await tx.agentSettlement.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This settlement is not waiting for approval', 409);
      if (!approve) return;
      const details = x.details as { perStaff: { courierId: string; work: number; other: number }[]; earningIds: string[] };
      const taken = await tx.courierEarning.updateMany({ where: { id: { in: details.earningIds }, settlementId: null }, data: { settlementId: x.id } });
      if (taken.count !== details.earningIds.length) throw new DomainError('conflict', 'Some of these earnings changed. Reject this settlement and create it again', 409);
      const agent = { type: 'AGENT' as const, id: x.agentId };
      await post(tx, {
        memo: `Agent settlement ${x.code} for ${x.month}`,
        source: 'AGENT_SETTLEMENT',
        key: `AGENT_SETTLEMENT:${x.id}`,
        userId: user.id,
        lines: [
          ...details.perStaff.flatMap((p): Line[] => {
            const net = p.work + p.other;
            return net >= 0
              ? [{ account: ACCOUNTS.COURIER_WALLET.code, party: { type: 'COURIER' as const, id: p.courierId }, debit: net }]
              : [{ account: ACCOUNTS.COURIER_WALLET.code, party: { type: 'COURIER' as const, id: p.courierId }, credit: -net }];
          }),
          x.staffPay >= 0 ? { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, credit: x.staffPay, memo: 'Staff pay' } : { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, debit: -x.staffPay, memo: 'Staff deductions' },
          { account: ACCOUNTS.AGENT_COMMISSION.code, debit: x.commission },
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, credit: x.commission, memo: 'Commission' },
          { account: ACCOUNTS.VEHICLE_RENT.code, debit: x.vehicleRent },
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, credit: x.vehicleRent, memo: 'Vehicle rent' },
          { account: ACCOUNTS.SPECIAL_VEHICLES.code, debit: x.specialVehicles },
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, credit: x.specialVehicles, memo: 'Special vehicles' },
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: agent, debit: x.penalties, memo: 'Late replacements' },
          { account: ACCOUNTS.OTHER_INCOME.code, credit: x.penalties },
        ],
      });
      await this.audit(tx, user, 'SETTLEMENT_APPROVED', 'agent_settlement', id, { total: x.total });
    });
  }

  async paySettlement(id: string, body: unknown, user: SessionUser) {
    const { reference } = parse(ReferenceInput, body ?? {});
    await this.prisma.tx(async (tx) => {
      const x = await tx.agentSettlement.findUnique({ where: { id }, select: { id: true, code: true, agentId: true, total: true, status: true, invoiceName: true } });
      if (!x || x.status !== 'APPROVED') throw new DomainError('bad_status', 'Approve the settlement before paying it', 409);
      if (!x.invoiceName) throw new DomainError('no_invoice', "Upload the agent's invoice before paying", 422);
      if (x.total <= 0) throw new DomainError('invalid_input', 'The agent owes us this month; nothing to pay', 422);
      await tx.agentSettlement.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Paid agent settlement ${x.code}`,
        source: 'AGENT_PAYMENT',
        key: `AGENT_PAYMENT:${x.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.AGENT_PAYABLE.code, party: { type: 'AGENT', id: x.agentId }, debit: x.total },
          { account: ACCOUNTS.BANK.code, credit: x.total, memo: reference },
        ],
      });
      await this.audit(tx, user, 'SETTLEMENT_PAID', 'agent_settlement', id, { total: x.total, reference });
    });
  }

  // ---------------------------------------------------------------- expenses and accounts

  accounts() {
    return this.prisma.account.findMany({ orderBy: { code: 'asc' } });
  }

  async addAccount(body: unknown, user: SessionUser) {
    const d = parse(AccountInput, body);
    if (await this.prisma.account.findUnique({ where: { code: d.code } })) throw new DomainError('duplicate', `Account ${d.code} already exists`, 409);
    const a = await this.prisma.account.create({ data: { ...d, type: 'EXPENSE' } });
    await this.audit(this.prisma, user, 'ACCOUNT_ADDED', 'account', d.code, d);
    return a;
  }

  async createExpense(body: unknown, user: SessionUser) {
    const d = parse(ExpenseInput, body);
    const acc = await this.prisma.account.findUnique({ where: { code: d.accountCode } });
    if (!acc || acc.type !== 'EXPENSE' || !acc.active) throw new DomainError('invalid_input', 'Pick an expense account', 422);
    if (d.paidFrom === 'HUB_SAFE' && !d.hubId) throw new DomainError('invalid_input', 'Pick the hub whose safe paid', 422);
    const file = d.receipt ? decodeFile(d.receipt) : null;
    return this.prisma.tx(async (tx) =>
      tx.expense.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'EX'), date: d.date, accountCode: d.accountCode, amount: d.amount, paidFrom: d.paidFrom, hubId: d.hubId ?? null,
          supplier: d.supplier, note: d.note, receipt: file?.data ?? null, receiptMime: file?.mime ?? '', createdById: user.id,
        },
        omit: { receipt: true },
      }),
    );
  }

  async expenses() {
    const rows = await this.prisma.expense.findMany({ omit: { receipt: true }, orderBy: { createdAt: 'desc' }, take: 200 });
    const accounts = new Map((await this.accounts()).map((a) => [a.code, a]));
    return rows.map((r) => ({ ...r, accountName: accounts.get(r.accountCode)?.name ?? r.accountCode, accountNameAr: accounts.get(r.accountCode)?.nameAr ?? '' }));
  }

  async expenseReceipt(id: string) {
    const e = await this.prisma.expense.findUnique({ where: { id }, select: { receipt: true, receiptMime: true, code: true } });
    if (!e?.receipt) throw notFound('Receipt');
    return { data: e.receipt, mime: e.receiptMime, name: e.code };
  }

  async decideExpense(id: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const e = await tx.expense.findUnique({ where: { id }, omit: { receipt: true } });
      if (!e) throw notFound('Expense');
      secondPerson(e.createdById, user);
      const r = await tx.expense.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: approve ? 'PAID' : 'REJECTED', approvedById: user.id } });
      if (r.count !== 1) throw new DomainError('bad_status', 'This expense is not waiting for approval', 409);
      if (approve) {
        await post(tx, {
          memo: `Expense ${e.code}${e.supplier ? ` · ${e.supplier}` : ''}${e.note ? ` · ${e.note}` : ''}`,
          source: 'EXPENSE',
          key: `EXPENSE:${e.id}`,
          date: e.date,
          userId: user.id,
          lines: [
            { account: e.accountCode, debit: e.amount },
            e.paidFrom === 'HUB_SAFE' ? { account: ACCOUNTS.HUB_SAFE.code, party: { type: 'HUB' as const, id: e.hubId! }, credit: e.amount } : { account: ACCOUNTS.BANK.code, credit: e.amount },
          ],
        });
      }
      await this.audit(tx, user, approve ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED', 'expense', id, { amount: e.amount });
    });
  }

  // ---------------------------------------------------------------- manual journals and closing

  async createJournal(body: unknown, user: SessionUser) {
    const d = parse(JournalInput, body);
    const debit = d.lines.reduce((n, l) => n + l.debit, 0);
    const credit = d.lines.reduce((n, l) => n + l.credit, 0);
    if (debit !== credit || debit === 0) throw new DomainError('unbalanced', `Debits (${formatEgp(debit)}) and credits (${formatEgp(credit)}) must match`, 422);
    for (const l of d.lines) if ((l.debit > 0) === (l.credit > 0)) throw new DomainError('invalid_input', 'Each line is either a debit or a credit', 422);
    return this.prisma.journalDraft.create({ data: { date: d.date, memo: d.memo, lines: d.lines as never, createdById: user.id } });
  }

  journalDrafts() {
    return this.prisma.journalDraft.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async decideJournal(id: string, approve: boolean, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const j = await tx.journalDraft.findUnique({ where: { id } });
      if (!j) throw notFound('Journal');
      secondPerson(j.createdById, user);
      if (j.status !== 'PENDING_APPROVAL') throw new DomainError('bad_status', 'This journal is not waiting for approval', 409);
      let entryId: string | null = null;
      if (approve) {
        const lines = JournalInput.shape.lines.parse(j.lines);
        const e = await post(tx, {
          memo: j.memo,
          source: 'MANUAL',
          key: `MANUAL:${j.id}`,
          date: j.date,
          userId: user.id,
          lines: lines.map((l) => ({ account: l.account, party: l.partyType && l.partyId ? { type: l.partyType, id: l.partyId } : null, debit: l.debit, credit: l.credit, memo: l.memo })),
        });
        entryId = e?.id ?? null;
      }
      await tx.journalDraft.update({ where: { id }, data: { status: approve ? 'PAID' : 'REJECTED', approvedById: user.id, entryId } });
      await this.audit(tx, user, approve ? 'JOURNAL_POSTED' : 'JOURNAL_REJECTED', 'journal_draft', id);
    });
  }

  /** Nothing can be posted on or before the closed date afterwards. Closing moves forward only. */
  async closeBooks(body: unknown, user: SessionUser) {
    const { date } = parse(CloseInput, body);
    if (date >= todayInCairo()) throw new DomainError('invalid_input', 'Close a day after it ends', 422);
    const s = await this.settings.all();
    if (s['books.closed_through'] && date <= s['books.closed_through']) throw new DomainError('invalid_input', `The books are already closed through ${s['books.closed_through']}`, 409);
    const { debit, credit } = await this.totals(date);
    if (debit !== credit) throw new DomainError('unbalanced', 'The books do not balance; this must be fixed before closing', 409);
    await this.settings.update('books.closed_through', date);
    await this.audit(this.prisma, user, 'BOOKS_CLOSED', 'setting', 'books.closed_through', { date });
    return { closedThrough: date };
  }

  private async totals(through?: string) {
    const r = await this.prisma.journalLine.aggregate({ where: through ? { entry: { date: { lte: through } } } : {}, _sum: { debit: true, credit: true } });
    return { debit: r._sum.debit ?? 0, credit: r._sum.credit ?? 0 };
  }

  async journal(query: { from?: string; to?: string; account?: string; source?: string }) {
    const { from, to } = parse(RangeInput, { from: query.from || undefined, to: query.to || undefined });
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.account ? { lines: { some: { accountCode: query.account } } } : {}),
      },
      include: { lines: true },
      orderBy: { number: 'desc' },
      take: 200,
    });
    return entries;
  }

  // ---------------------------------------------------------------- reports

  private async accountTotals(where: Prisma.JournalLineWhereInput) {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({ by: ['accountCode'], where, _sum: { debit: true, credit: true } }),
    ]);
    return accounts.map((a) => {
      const row = sums.find((x) => x.accountCode === a.code);
      const debit = row?._sum.debit ?? 0;
      const credit = row?._sum.credit ?? 0;
      const balance = normalBalance(a.type) === 'DEBIT' ? debit - credit : credit - debit;
      return { code: a.code, name: a.name, nameAr: a.nameAr, type: a.type, debit, credit, balance };
    });
  }

  async trialBalance(through?: string) {
    const d = through ? parse(DATE, through) : undefined;
    const rows = (await this.accountTotals(d ? { entry: { date: { lte: d } } } : {})).filter((r) => r.debit || r.credit);
    const debit = rows.reduce((n, r) => n + r.debit, 0);
    const credit = rows.reduce((n, r) => n + r.credit, 0);
    return { through: d ?? todayInCairo(), rows, debit, credit, balanced: debit === credit };
  }

  async profitAndLoss(fromQ?: string, toQ?: string) {
    const today = todayInCairo();
    const from = fromQ ? parse(DATE, fromQ) : `${today.slice(0, 7)}-01`;
    const to = toQ ? parse(DATE, toQ) : today;
    const rows = await this.accountTotals({ entry: { date: { gte: from, lte: to } }, account: { type: { in: ['INCOME', 'EXPENSE'] } } });
    const income = rows.filter((r) => r.type === 'INCOME');
    const expenses = rows.filter((r) => r.type === 'EXPENSE');
    const totalIncome = income.reduce((n, r) => n + r.balance, 0);
    const totalExpenses = expenses.reduce((n, r) => n + r.balance, 0);
    return { from, to, income, expenses, totalIncome, totalExpenses, profit: totalIncome - totalExpenses };
  }

  async balanceSheet(through?: string) {
    const d = through ? parse(DATE, through) : todayInCairo();
    const rows = await this.accountTotals({ entry: { date: { lte: d } } });
    const pick = (t: string) => rows.filter((r) => r.type === t);
    const sum = (rs: { balance: number }[]) => rs.reduce((n, r) => n + r.balance, 0);
    const earnings = sum(pick('INCOME')) - sum(pick('EXPENSE'));
    const assets = sum(pick('ASSET'));
    const liabilities = sum(pick('LIABILITY'));
    const equity = sum(pick('EQUITY')) + earnings;
    return { through: d, assets: pick('ASSET'), liabilities: pick('LIABILITY'), equity: pick('EQUITY'), earnings, totalAssets: assets, totalLiabilities: liabilities, totalEquity: equity, balanced: assets === liabilities + equity };
  }

  /** How old the money is that we still hold: cash with couriers, and what merchants are waiting for. */
  async codAging() {
    const now = Date.now();
    const bucket = (at: Date | null) => {
      const days = at ? Math.floor((now - at.getTime()) / 86400000) : 0;
      return days <= 3 ? '0_3' : days <= 7 ? '4_7' : days <= 14 ? '8_14' : '15_plus';
    };
    const unpaid = await this.prisma.shipment.findMany({
      where: { status: { in: ['DELIVERED', 'RETURNED'] }, payoutId: null },
      select: { merchantId: true, closedAt: true, codCollected: true, status: true, shippingFee: true, codFee: true, returnFee: true },
    });
    const merchants = new Map((await this.prisma.merchant.findMany({ select: { id: true, name: true } })).map((m) => [m.id, m.name]));
    const byMerchant = new Map<string, Record<string, number> & { total: number }>();
    for (const p of unpaid) {
      const row = byMerchant.get(p.merchantId) ?? { '0_3': 0, '4_7': 0, '8_14': 0, '15_plus': 0, total: 0 };
      const owed = p.codCollected - feesOf(p);
      row[bucket(p.closedAt)]! += owed;
      row.total += owed;
      byMerchant.set(p.merchantId, row);
    }
    // Cash with couriers, aged by the oldest delivery still not handed in.
    const cash = await partyBalances(this.prisma, ACCOUNTS.COURIER_CASH.code);
    const holders = [...cash.entries()].filter(([, v]) => v > 0);
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: holders.map(([id]) => id) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const couriers = [];
    for (const [id, amount] of holders) {
      const oldest = await this.prisma.runItem.findFirst({ where: { run: { courierId: id, status: { not: 'CLOSED' } }, codCollected: { gt: 0 } }, orderBy: { resolvedAt: 'asc' }, select: { resolvedAt: true } });
      const at = oldest?.resolvedAt ?? null;
      couriers.push({ courierId: id, name: names.get(id) ?? '', amount, since: at, bucket: bucket(at) });
    }
    return {
      merchants: [...byMerchant.entries()].map(([id, r]) => ({ merchantId: id, name: merchants.get(id) ?? '', ...r })).sort((a, b) => b.total - a.total),
      couriers: couriers.sort((a, b) => b.amount - a.amount),
    };
  }

  /** Balances on every wallet account, with names. */
  async wallets(kind: PartyType) {
    const account = { MERCHANT: ACCOUNTS.MERCHANT_WALLET, COURIER: ACCOUNTS.COURIER_WALLET, AGENT: ACCOUNTS.AGENT_PAYABLE, HUB: ACCOUNTS.HUB_SAFE }[kind];
    const balances = await partyBalances(this.prisma, account.code);
    const ids = [...balances.keys()];
    const names =
      kind === 'MERCHANT' ? await this.prisma.merchant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : kind === 'AGENT' ? await this.prisma.agent.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : kind === 'HUB' ? await this.prisma.hub.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const sign = normalBalance(account.type) === 'DEBIT' ? 1 : -1;
    return ids.map((id) => ({ id, name: nameOf.get(id) ?? '', balance: sign * (balances.get(id) ?? 0) })).filter((r) => r.balance !== 0).sort((a, b) => b.balance - a.balance);
  }

  /** Everything waiting for someone in finance, for the inbox at the top of the money page. */
  async inbox(user: SessionUser) {
    const [payouts, withdrawals, payIns, deposits, settlements, expenses, journals, bankChanges] = await Promise.all([
      this.prisma.payout.findMany({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } }, select: { id: true, code: true, amount: true, status: true, createdById: true, merchant: { select: { name: true } } } }),
      this.prisma.withdrawal.count({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.payIn.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.safeDeposit.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.agentSettlement.count({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.expense.count({ where: { status: 'PENDING_APPROVAL' } }),
      this.prisma.journalDraft.count({ where: { status: 'PENDING_APPROVAL' } }),
      this.prisma.merchant.findMany({ where: { NOT: { pendingBankById: null } }, select: { id: true, name: true, pendingBank: true, pendingBankById: true } }),
    ]);
    const s = await this.settings.all();
    const { debit, credit } = await this.totals();
    return {
      payoutsToApprove: payouts.filter((p) => p.status === 'PENDING_APPROVAL').length,
      payoutsYouCanApprove: payouts.filter((p) => p.status === 'PENDING_APPROVAL' && p.createdById !== user.id).length,
      payoutsToPay: payouts.filter((p) => p.status === 'APPROVED').length,
      withdrawals, payIns, deposits, settlements, expenses, journals,
      bankChanges: bankChanges.map((m) => ({ merchantId: m.id, name: m.name, pending: m.pendingBank, mine: m.pendingBankById === user.id })),
      closedThrough: s['books.closed_through'],
      balanced: debit === credit,
    };
  }
}
