import { Injectable } from '@nestjs/common';
import { billAgentSettlement } from '@shiplynow/db';
import {
  ACCOUNTS,
  applyBp,
  formatEgp,
  normalBalance,
  type PartyType,
} from '@shiplynow/shared/parcels';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { partyBalances, post, rawBalance, type Line } from './ledger';
import { courierStanding, earn, paidByAgent } from './postings';

const MAX_FILE = 5 * 1024 * 1024;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11');
const MONEY = z.number().int().min(1, 'Enter an amount').max(1_000_000_000);
const FILE = z.object({
  fileName: z.string().trim().min(1).max(160).default('file'),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  dataBase64: z.string().min(8),
});

const NoteInput = z.object({ note: z.string().trim().max(300).default('') });
const WithdrawInput = z.object({
  amount: MONEY,
  method: z
    .string()
    .trim()
    .min(3, 'Say how you want to be paid, for example InstaPay 010...')
    .max(120),
});
const AdjustInput = z.object({
  kind: z.enum(['BONUS', 'PENALTY', 'ADJUSTMENT']),
  amount: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((n) => n !== 0, 'Enter an amount'),
  note: z.string().trim().min(3, 'Write the reason').max(200),
});
const UnfreezeInput = z.object({
  reason: z.string().trim().min(5, 'Write the reason').max(200),
  hours: z.number().int().min(1).max(72).default(24),
});
const PayInInput = z.object({
  amount: MONEY,
  channel: z.enum(['FAWRY', 'BASATA', 'BANK_TRANSFER']).default('FAWRY'),
  purpose: z.enum(['CASH', 'RECHARGE']).default('CASH'),
  reference: z.string().trim().min(3, 'Enter the receipt or reference number').max(80),
  runId: z.string().min(1).max(64).nullish(),
  receipt: FILE,
});
const DepositInput = z.object({
  amount: MONEY,
  reference: z.string().trim().min(3).max(80),
  receipt: FILE.nullish(),
});
const SettlementInput = z.object({ agentId: z.string().min(1).max(64), month: MONTH });

function decodeFile(f: z.infer<typeof FILE>) {
  const clean = f.dataBase64.includes(',')
    ? f.dataBase64.slice(f.dataBase64.indexOf(',') + 1)
    : f.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0) throw new DomainError('invalid_input', 'The file is empty', 422);
  if (buf.length > MAX_FILE)
    throw new DomainError('invalid_input', 'The file is larger than 5 MB', 422);
  return { data: new Uint8Array(buf), mime: f.mime, name: f.fileName };
}

/** The second person rule: whoever created a money request cannot approve it. */
function secondPerson(createdById: string | null | undefined, user: SessionUser) {
  if (createdById === user.id)
    throw new DomainError('same_person', 'Someone else must approve what you created', 403);
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
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

  private audit(
    db: Tx | PrismaService,
    user: SessionUser,
    action: string,
    entity: string,
    entityId: string,
    data: unknown = {},
  ) {
    return db.auditLog.create({
      data: {
        actorUserId: user.id,
        action,
        entityType: entity,
        entityId,
        after: JSON.parse(JSON.stringify(data)),
      },
    });
  }

  // ---------------------------------------------------------------- merchant bank details

  /** The first bank details apply at once; any change after that waits for a second person. */
  // ---------------------------------------------------------------- merchant payouts

  /** Every merchant with money ready, whether today is one of their payout days, and their bank status. */
  /** Puts everything ready for one merchant into a payout that a second person must approve. */
  /** Creates payouts for every merchant whose payout day is today and who has money ready. */
  /** The bank sent the money: the merchant's balance goes down, the bank goes down, we keep the fee. */
  /** A bulk transfer file for the bank (CIB layout): approved merchant payouts and agent settlements. */
  // ---------------------------------------------------------------- courier wallets

  async couriers() {
    const s = await this.settings.all();
    const [users, wallets, cash] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'courier' },
        select: {
          id: true,
          name: true,
          phone: true,
          courierType: true,
          agentId: true,
          unfreezeUntil: true,
          hub: { select: { code: true } },
          agent: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      partyBalances(this.prisma, ACCOUNTS.COURIER_WALLET.code),
      partyBalances(this.prisma, ACCOUNTS.COURIER_CASH.code),
    ]);
    const now = new Date();
    return users.map((u) => {
      const wallet = -(wallets.get(u.id) ?? 0);
      return {
        id: u.id,
        name: u.name,
        phone: u.phone,
        courierType: u.courierType,
        hub: u.hub?.code ?? '',
        agent: u.agent?.name ?? '',
        wallet,
        cashToHandIn: cash.get(u.id) ?? 0,
        paidByAgent: paidByAgent(u, s),
        frozen: wallet < 0 && !(u.unfreezeUntil && u.unfreezeUntil > now),
      };
    });
  }

  async courierWallet(courierId: string) {
    const s = await this.settings.all();
    const u = await this.prisma.user.findUnique({
      where: { id: courierId },
      select: { id: true, name: true, role: true },
    });
    if (!u || u.role !== 'courier') throw notFound('Courier');
    const [standing, earnings, withdrawals, payIns] = await Promise.all([
      courierStanding(this.prisma, s, courierId),
      this.prisma.courierEarning.findMany({
        where: { courierId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.withdrawal.findMany({
        where: { courierId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.payIn.findMany({
        where: { courierId },
        omit: { receipt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      courier: { id: u.id, name: u.name },
      ...standing,
      pointValue: s['pay.point_value'],
      freezeDays: s['pay.freeze_days'],
      earnings,
      withdrawals,
      payIns,
    };
  }

  async requestWithdrawal(user: SessionUser, body: unknown) {
    const d = parse(WithdrawInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const st = await courierStanding(tx, s, user.id);
      if (st.paidByAgent)
        throw new DomainError(
          'paid_by_agent',
          'Your agent pays you. Your earnings go to your agent at month end',
          409,
        );
      const open = await tx.withdrawal.findFirst({
        where: { courierId: user.id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      });
      if (open)
        throw new DomainError('duplicate', `You already have request ${open.code} waiting`, 409);
      if (d.amount > st.withdrawable)
        throw new DomainError(
          'too_much',
          `You can withdraw up to ${formatEgp(st.withdrawable)} now`,
          422,
        );
      const w = await tx.withdrawal.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'WD'),
          courierId: user.id,
          amount: d.amount,
          method: d.method,
          requestedById: user.id,
        },
      });
      return w;
    });
  }

  withdrawals(status?: string) {
    return this.prisma.withdrawal
      .findMany({
        where: status ? { status: status as never } : {},
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      .then(async (rows) => {
        const names = new Map(
          (
            await this.prisma.user.findMany({
              where: { id: { in: rows.map((r) => r.courierId) } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name]),
        );
        return rows.map((r) => ({ ...r, courierName: names.get(r.courierId) ?? '' }));
      });
  }

  async decideWithdrawal(id: string, approve: boolean, body: unknown, user: SessionUser) {
    const { note } = parse(NoteInput, body ?? {});
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw notFound('Withdrawal');
    secondPerson(w.requestedById, user);
    const r = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id, note },
    });
    if (r.count !== 1)
      throw new DomainError('bad_status', 'This request is not waiting for approval', 409);
    await this.audit(
      this.prisma,
      user,
      approve ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED',
      'withdrawal',
      id,
      { note },
    );
  }

  async payWithdrawal(id: string, user: SessionUser) {
    const s = await this.settings.all();
    await this.prisma.tx(async (tx) => {
      const w = await tx.withdrawal.findUnique({ where: { id } });
      if (!w || w.status !== 'APPROVED')
        throw new DomainError('bad_status', 'Approve the request before paying it', 409);
      // Check again at payment time: the wallet may have changed since the request.
      const st = await courierStanding(tx, s, w.courierId);
      if (w.amount > st.withdrawable)
        throw new DomainError(
          'too_much',
          `The courier can only withdraw ${formatEgp(st.withdrawable)} now`,
          409,
        );
      await tx.withdrawal.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Withdrawal ${w.code}`,
        source: 'WITHDRAWAL',
        key: `WITHDRAWAL:${w.id}`,
        userId: user.id,
        lines: [
          {
            account: ACCOUNTS.COURIER_WALLET.code,
            party: { type: 'COURIER', id: w.courierId },
            debit: w.amount,
          },
          { account: ACCOUNTS.BANK.code, credit: w.amount, memo: w.method },
        ],
      });
      await this.audit(tx, user, 'WITHDRAWAL_PAID', 'withdrawal', id, { amount: w.amount });
    });
  }

  /** Bonus, penalty or correction on a courier's wallet, with a reason. */
  async adjustCourier(courierId: string, body: unknown, user: SessionUser) {
    const d = parse(AdjustInput, body);
    if (d.kind === 'BONUS' && d.amount < 0)
      throw new DomainError('invalid_input', 'A bonus is a positive amount', 422);
    if (d.kind === 'PENALTY' && d.amount > 0)
      throw new DomainError('invalid_input', 'A penalty is a negative amount', 422);
    const s = await this.settings.all();
    const c = await this.prisma.user.findFirst({ where: { id: courierId, role: 'courier' } });
    if (!c) throw notFound('Courier');
    return this.prisma.tx(async (tx) => {
      const e = await earn(tx, s, {
        courierId,
        kind: d.kind,
        amount: d.amount,
        note: d.note,
        userId: user.id,
      });
      await this.audit(tx, user, 'COURIER_ADJUSTED', 'user', courierId, d);
      return e;
    });
  }

  /** Lets a courier with a negative wallet work for a while. Always with a reason, always audited. */
  async unfreeze(courierId: string, body: unknown, user: SessionUser) {
    const d = parse(UnfreezeInput, body);
    const until = new Date(Date.now() + d.hours * 3600 * 1000);
    const r = await this.prisma.user.updateMany({
      where: { id: courierId, role: 'courier' },
      data: { unfreezeUntil: until, unfreezeReason: d.reason },
    });
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
        data: {
          code: await nextCode(tx, 'money_seq', 'PI'),
          courierId: user.id,
          runId: d.runId ?? null,
          amount: d.amount,
          channel: d.channel,
          purpose: d.purpose,
          reference: d.reference,
          receipt: file.data,
          receiptMime: file.mime,
        },
        omit: { receipt: true },
      });
      return p;
    });
  }

  payIns(status?: string) {
    return this.prisma.payIn
      .findMany({
        where: status ? { status: status as never } : {},
        omit: { receipt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      .then(async (rows) => {
        const names = new Map(
          (
            await this.prisma.user.findMany({
              where: { id: { in: rows.map((r) => r.courierId) } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name]),
        );
        return rows.map((r) => ({ ...r, courierName: names.get(r.courierId) ?? '' }));
      });
  }

  async payInReceipt(id: string, courierId?: string) {
    const p = await this.prisma.payIn.findUnique({
      where: { id },
      select: { receipt: true, receiptMime: true, code: true, courierId: true },
    });
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
      const r = await tx.payIn.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: {
          status: approve ? 'CONFIRMED' : 'REJECTED',
          checkedById: user.id,
          checkedAt: new Date(),
          note,
        },
      });
      if (r.count !== 1)
        throw new DomainError('bad_status', 'This pay in was already checked', 409);
      if (approve) {
        const run = p.runId ? await tx.run.findUnique({ where: { id: p.runId } }) : null;
        const toCash = p.purpose === 'CASH' && (!run || run.status !== 'CLOSED');
        const cashOwed = await rawBalance(tx, ACCOUNTS.COURIER_CASH.code, {
          type: 'COURIER',
          id: p.courierId,
        });
        const cashPart = toCash ? Math.min(p.amount, Math.max(0, cashOwed)) : 0;
        await post(tx, {
          memo: `Pay in ${p.code} (${p.channel.toLowerCase()} ${p.reference})`,
          source: 'PAY_IN',
          key: `PAY_IN:${p.id}`,
          userId: user.id,
          lines: [
            { account: ACCOUNTS.BANK.code, debit: cashPart },
            {
              account: ACCOUNTS.COURIER_CASH.code,
              party: { type: 'COURIER', id: p.courierId },
              credit: cashPart,
            },
          ],
        });
        // The rest goes into the wallet as an entry the agent settlement sees, so a shortage the
        // courier repaid is not charged to the agent too.
        if (p.amount - cashPart > 0) {
          await earn(tx, await this.settings.all(tx), {
            courierId: p.courierId,
            kind: 'ADJUSTMENT',
            amount: p.amount - cashPart,
            note: `${p.purpose === 'RECHARGE' ? 'Recharge' : 'Cash paid in'} ${p.code}`,
            userId: user.id,
            contra: { account: ACCOUNTS.BANK.code },
          });
        }
      }
      await this.audit(tx, user, approve ? 'PAY_IN_CONFIRMED' : 'PAY_IN_REJECTED', 'pay_in', id, {
        amount: p.amount,
        note,
      });
    });
  }

  // ---------------------------------------------------------------- hub safes and bank deposits

  async safe(hubId: string) {
    const [balance, deposits] = await Promise.all([
      rawBalance(this.prisma, ACCOUNTS.HUB_SAFE.code, { type: 'HUB', id: hubId }),
      this.prisma.safeDeposit.findMany({
        where: { hubId },
        omit: { receipt: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    const waiting = deposits
      .filter((d) => d.status === 'SUBMITTED')
      .reduce((n, d) => n + d.amount, 0);
    return { balance, waitingDeposits: waiting, available: balance - waiting, deposits };
  }

  async createDeposit(hubId: string, body: unknown, user: SessionUser) {
    const d = parse(DepositInput, body);
    const file = d.receipt ? decodeFile(d.receipt) : null;
    const safe = await this.safe(hubId);
    if (d.amount > safe.available)
      throw new DomainError(
        'too_much',
        `The safe has ${formatEgp(safe.available)} not yet deposited`,
        422,
      );
    return this.prisma.tx(async (tx) =>
      tx.safeDeposit.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'DP'),
          hubId,
          amount: d.amount,
          reference: d.reference,
          receipt: file?.data ?? null,
          receiptMime: file?.mime ?? '',
          createdById: user.id,
        },
        omit: { receipt: true },
      }),
    );
  }

  async deposits(status?: string) {
    const rows = await this.prisma.safeDeposit.findMany({
      where: status ? { status: status as never } : {},
      omit: { receipt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const hubs = new Map(
      (await this.prisma.hub.findMany({ select: { id: true, code: true, name: true } })).map(
        (h) => [h.id, h],
      ),
    );
    return rows.map((r) => ({ ...r, hub: hubs.get(r.hubId) ?? null }));
  }

  async depositReceipt(id: string) {
    const d = await this.prisma.safeDeposit.findUnique({
      where: { id },
      select: { receipt: true, receiptMime: true, code: true },
    });
    if (!d?.receipt) throw notFound('Receipt');
    return { data: d.receipt, mime: d.receiptMime, name: d.code };
  }

  async decideDeposit(id: string, approve: boolean, body: unknown, user: SessionUser) {
    const { note } = parse(NoteInput, body ?? {});
    await this.prisma.tx(async (tx) => {
      const d = await tx.safeDeposit.findUnique({ where: { id }, omit: { receipt: true } });
      if (!d) throw notFound('Deposit');
      secondPerson(d.createdById, user);
      const r = await tx.safeDeposit.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: {
          status: approve ? 'CONFIRMED' : 'REJECTED',
          checkedById: user.id,
          checkedAt: new Date(),
          note,
        },
      });
      if (r.count !== 1)
        throw new DomainError('bad_status', 'This deposit was already checked', 409);
      if (approve) {
        await post(tx, {
          memo: `Deposit ${d.code} from hub safe (${d.reference})`,
          source: 'SAFE_DEPOSIT',
          key: `SAFE_DEPOSIT:${d.id}`,
          userId: user.id,
          lines: [
            { account: ACCOUNTS.BANK.code, debit: d.amount },
            {
              account: ACCOUNTS.HUB_SAFE.code,
              party: { type: 'HUB', id: d.hubId },
              credit: d.amount,
            },
          ],
        });
      }
      await this.audit(
        tx,
        user,
        approve ? 'DEPOSIT_CONFIRMED' : 'DEPOSIT_REJECTED',
        'safe_deposit',
        id,
        { amount: d.amount, note },
      );
    });
  }

  // ---------------------------------------------------------------- agent month end

  /** What an agent is owed for a month, worked out from the records, before anything is posted. */
  async computeSettlement(db: Tx | PrismaService, agentId: string, month: string) {
    const s = await this.settings.all(db);
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: { vehicles: { where: { active: true, contract: 'FIXED' } } },
    });
    if (!agent) throw notFound('Agent');
    const { from, to } = monthRange(month);
    const staff = await db.user.findMany({
      where: { agentId, role: 'courier' },
      select: { id: true, name: true, agentId: true, courierType: true },
    });
    const viaAgent = staff.filter((u) => paidByAgent(u, s));
    const earnings = await db.courierEarning.findMany({
      where: {
        agentId,
        courierId: { in: viaAgent.map((u) => u.id) },
        date: { gte: from, lte: to },
        settlementId: null,
      },
    });
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
          parcels: mine.filter(
            (e) => e.kind === 'DELIVERY' || e.kind === 'RETURN' || e.kind === 'PICKUP',
          ).length,
        };
      })
      .filter((x) => x.work !== 0 || x.other !== 0);
    const earned = perStaff.reduce((n, x) => n + x.work, 0);
    const deducted = perStaff.reduce((n, x) => n + x.other, 0);
    const commissionBp = agent.commissionBp ?? s['agents.default_commission_bp'];
    const commission = applyBp(earned, commissionBp);
    const vehicles = agent.vehicles.map((v) => ({ id: v.id, plate: v.plate, rent: v.monthlyRent }));
    const vehicleRent = vehicles.reduce((n, v) => n + v.rent, 0);
    const special = await db.vehicleRequest.findMany({
      where: { agentId, status: 'DONE', date: { gte: from, lte: to } },
      select: { id: true, code: true, date: true, price: true },
    });
    const specialVehicles = special.reduce((n, r) => n + r.price, 0);
    const overdue = await db.courierShift.findMany({
      where: { agentId, replacementOverdue: true, date: { gte: from, lte: to } },
      select: { id: true, date: true },
    });
    const penalties = overdue.length * s['attendance.replacement_penalty'];
    const staffPay = earned + deducted;
    return {
      agent: { id: agent.id, name: agent.name, code: agent.code },
      month,
      staffPay,
      commissionBp,
      commission,
      vehicleRent,
      specialVehicles,
      penalties,
      total: staffPay + commission + vehicleRent + specialVehicles - penalties,
      details: {
        perStaff,
        vehicles,
        special,
        overdueReplacements: overdue.length,
        penaltyEach: s['attendance.replacement_penalty'],
        earningIds: earnings.map((e) => e.id),
      },
    };
  }

  previewSettlement(query: unknown) {
    const d = parse(SettlementInput, query);
    return this.computeSettlement(this.prisma, d.agentId, d.month);
  }

  async createSettlement(body: unknown, user: SessionUser) {
    const d = parse(SettlementInput, body);
    if (d.month >= todayInCairo().slice(0, 7))
      throw new DomainError('invalid_input', 'Settle a month after it ends', 422);
    return this.prisma.tx(async (tx) => {
      const exists = await tx.agentSettlement.findUnique({
        where: { agentId_month: { agentId: d.agentId, month: d.month } },
      });
      if (exists && exists.status !== 'REJECTED')
        throw new DomainError(
          'duplicate',
          `This month is already in settlement ${exists.code}`,
          409,
        );
      if (exists) await tx.agentSettlement.delete({ where: { id: exists.id } });
      const c = await this.computeSettlement(tx, d.agentId, d.month);
      // Advances paid and not yet taken off a settlement come off this payment.
      const adv = await tx.agentAdvance.findMany({
        where: { agentId: d.agentId, status: 'PAID', settlementId: null },
        select: { id: true, amount: true },
      });
      const advances = adv.reduce((n, a) => n + a.amount, 0);
      const x = await tx.agentSettlement.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'AS'),
          agentId: d.agentId,
          month: d.month,
          staffPay: c.staffPay,
          commissionBp: c.commissionBp,
          commission: c.commission,
          vehicleRent: c.vehicleRent,
          specialVehicles: c.specialVehicles,
          penalties: c.penalties,
          total: c.total,
          advances,
          details: { ...c.details, advanceIds: adv.map((a) => a.id) } as never,
          createdById: user.id,
        },
        omit: { invoice: true },
      });
      await this.audit(tx, user, 'SETTLEMENT_CREATED', 'agent_settlement', x.id, {
        total: c.total,
      });
      return x;
    });
  }

  async settlements(agentId?: string) {
    const rows = await this.prisma.agentSettlement.findMany({
      where: agentId ? { agentId } : {},
      omit: { invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const agents = new Map(
      (await this.prisma.agent.findMany({ select: { id: true, name: true, code: true } })).map(
        (a) => [a.id, a],
      ),
    );
    const bills = new Map(
      (
        await this.prisma.bill.findMany({
          where: { id: { in: rows.map((r) => r.billId).filter((b): b is string => !!b) } },
          select: { id: true, number: true, status: true, paidPiastres: true, totalPiastres: true },
        })
      ).map((b) => [b.id, b]),
    );
    return rows.map((r) => {
      const bill = r.billId ? bills.get(r.billId) : undefined;
      return {
        ...r,
        agent: agents.get(r.agentId) ?? null,
        hasInvoice: !!r.invoiceName,
        // Paid in Accounting: the supplier bill of this settlement
        bill: bill
          ? {
              id: bill.id,
              number: `BILL-${String(bill.number).padStart(6, '0')}`,
              status: bill.status,
              leftPiastres: bill.status === 'open' ? bill.totalPiastres - bill.paidPiastres : 0,
            }
          : null,
      };
    });
  }

  async uploadInvoice(id: string, body: unknown, user: SessionUser, agentId?: string) {
    const f = decodeFile(parse(FILE, body));
    const r = await this.prisma.agentSettlement.updateMany({
      where: {
        id,
        ...(agentId ? { agentId } : {}),
        status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
      },
      data: { invoice: f.data, invoiceMime: f.mime, invoiceName: f.name },
    });
    if (r.count !== 1) throw notFound('Open settlement');
    await this.audit(this.prisma, user, 'SETTLEMENT_INVOICE', 'agent_settlement', id, {
      name: f.name,
    });
  }

  async invoice(id: string, agentId?: string) {
    const x = await this.prisma.agentSettlement.findUnique({
      where: { id },
      select: { invoice: true, invoiceMime: true, invoiceName: true, agentId: true },
    });
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
      const r = await tx.agentSettlement.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id },
      });
      if (r.count !== 1)
        throw new DomainError('bad_status', 'This settlement is not waiting for approval', 409);
      if (!approve) return;
      const details = x.details as {
        perStaff: { courierId: string; work: number; other: number }[];
        earningIds: string[];
        advanceIds?: string[];
      };
      if (details.advanceIds?.length)
        await tx.agentAdvance.updateMany({
          where: { id: { in: details.advanceIds } },
          data: { settlementId: x.id },
        });
      const taken = await tx.courierEarning.updateMany({
        where: { id: { in: details.earningIds }, settlementId: null },
        data: { settlementId: x.id },
      });
      if (taken.count !== details.earningIds.length)
        throw new DomainError(
          'conflict',
          'Some of these earnings changed. Reject this settlement and create it again',
          409,
        );
      const agent = { type: 'AGENT' as const, id: x.agentId };
      const entry = await post(tx, {
        memo: `Agent settlement ${x.code} for ${x.month}`,
        source: 'AGENT_SETTLEMENT',
        key: `AGENT_SETTLEMENT:${x.id}`,
        // The month's cost belongs to that month: booked on its last day once it is over.
        date: lastDayOf(x.month) < todayInCairo() ? lastDayOf(x.month) : undefined,
        userId: user.id,
        lines: [
          ...details.perStaff.flatMap((p): Line[] => {
            const net = p.work + p.other;
            return net >= 0
              ? [
                  {
                    account: ACCOUNTS.COURIER_WALLET.code,
                    party: { type: 'COURIER' as const, id: p.courierId },
                    debit: net,
                  },
                ]
              : [
                  {
                    account: ACCOUNTS.COURIER_WALLET.code,
                    party: { type: 'COURIER' as const, id: p.courierId },
                    credit: -net,
                  },
                ];
          }),
          x.staffPay >= 0
            ? {
                account: ACCOUNTS.AGENT_PAYABLE.code,
                party: agent,
                credit: x.staffPay,
                memo: 'Staff pay',
              }
            : {
                account: ACCOUNTS.AGENT_PAYABLE.code,
                party: agent,
                debit: -x.staffPay,
                memo: 'Staff deductions',
              },
          { account: ACCOUNTS.AGENT_COMMISSION.code, debit: x.commission },
          {
            account: ACCOUNTS.AGENT_PAYABLE.code,
            party: agent,
            credit: x.commission,
            memo: 'Commission',
          },
          { account: ACCOUNTS.VEHICLE_RENT.code, debit: x.vehicleRent },
          {
            account: ACCOUNTS.AGENT_PAYABLE.code,
            party: agent,
            credit: x.vehicleRent,
            memo: 'Vehicle rent',
          },
          { account: ACCOUNTS.SPECIAL_VEHICLES.code, debit: x.specialVehicles },
          {
            account: ACCOUNTS.AGENT_PAYABLE.code,
            party: agent,
            credit: x.specialVehicles,
            memo: 'Special vehicles',
          },
          {
            account: ACCOUNTS.AGENT_PAYABLE.code,
            party: agent,
            debit: x.penalties,
            memo: 'Late replacements',
          },
          { account: ACCOUNTS.OTHER_INCOME.code, credit: x.penalties },
        ],
      });
      // The agent is a supplier: Accounting pays the settlement as a supplier bill.
      if (entry)
        await billAgentSettlement(tx, {
          settlementId: x.id,
          entryId: entry.id,
          actorUserId: user.id,
        });
      await this.audit(tx, user, 'SETTLEMENT_APPROVED', 'agent_settlement', id, { total: x.total });
    });
  }

  // ---------------------------------------------------------------- expenses and accounts

  // ---------------------------------------------------------------- manual journals and closing

  /** How old the money is that we still hold: cash with couriers, and what merchants are waiting for. */
  /** Balances on every wallet account, with names. */
  async wallets(kind: PartyType) {
    const account = {
      MERCHANT: ACCOUNTS.MERCHANT_WALLET,
      COURIER: ACCOUNTS.COURIER_WALLET,
      AGENT: ACCOUNTS.AGENT_PAYABLE,
      HUB: ACCOUNTS.HUB_SAFE,
      SUPPLIER: ACCOUNTS.SUPPLIER_PAYABLE,
    }[kind];
    const balances = await partyBalances(this.prisma, account.code);
    const ids = [...balances.keys()];
    const names =
      kind === 'MERCHANT'
        ? await this.prisma.merchant.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : kind === 'AGENT'
          ? await this.prisma.agent.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            })
          : kind === 'HUB'
            ? await this.prisma.hub.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              })
            : kind === 'SUPPLIER'
              ? await this.prisma.supplier.findMany({
                  where: { id: { in: ids } },
                  select: { id: true, name: true },
                })
              : await this.prisma.user.findMany({
                  where: { id: { in: ids } },
                  select: { id: true, name: true },
                });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const sign = normalBalance(account.type) === 'DEBIT' ? 1 : -1;
    return ids
      .map((id) => ({ id, name: nameOf.get(id) ?? '', balance: sign * (balances.get(id) ?? 0) }))
      .filter((r) => r.balance !== 0)
      .sort((a, b) => b.balance - a.balance);
  }

  /**
   * Network money waiting for someone in finance. Payouts, expenses, journals, bills and tax
   * documents are Shiply Now's finance and wait in its inbox; their counts here stay zero.
   */
  async inbox(_user: SessionUser) {
    const [withdrawals, payIns, deposits, settlements, advances] = await Promise.all([
      this.prisma.withdrawal.count({ where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } }),
      this.prisma.payIn.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.safeDeposit.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.agentSettlement.count({
        where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      }),
      this.prisma.agentAdvance.count({
        where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] } },
      }),
    ]);
    return {
      payoutsToApprove: 0,
      payoutsYouCanApprove: 0,
      payoutsToPay: 0,
      withdrawals,
      payIns,
      deposits,
      settlements,
      expenses: 0,
      journals: 0,
      bills: 0,
      creditNotes: 0,
      advances,
      bankChanges: [],
      closedThrough: '',
      balanced: true,
    };
  }
}

/** The last Cairo day of a month (YYYY-MM): 2026-10 → 2026-10-31. */
function lastDayOf(month: string) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 0));
  return d.toISOString().slice(0, 10);
}
