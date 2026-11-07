import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACCOUNTS, applyBp, formatEgp } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import { resolveAlerts, openAlert } from '../agents/alerts';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { todayInCairo } from '../core/shipments.core';
import { FinanceService } from './finance.service';
import { partyBalances, post } from './ledger';

const MONEY = z.number().int().min(1, 'Enter an amount').max(1_000_000_000);

const AdvanceInput = z.object({ amount: MONEY, note: z.string().trim().max(200).default('') });

function secondPerson(createdById: string | null | undefined, user: SessionUser) {
  if (createdById === user.id)
    throw new DomainError('same_person', 'Someone else must approve what you created', 403);
}

/**
 * The rest of the books: tax invoices and credit notes (with the ETA file), VAT and withholding
 * tax, suppliers and their bills, the bank statement matched to the books, cash flow, profit
 * per merchant, hub and courier, budgets, cash limits, and agent advances.
 */
@Injectable()
export class BooksService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly finance: FinanceService,
  ) {}

  onModuleInit() {
    if (process.env.SHIPLY_JOBS === 'off') return;
    this.timer = setInterval(
      () => void this.cashLimitCheck().catch((e) => console.error('cash limits', e)),
      10 * 60_000,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

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

  // ---------------------------------------------------------------- tax invoices

  /** Issues one invoice per merchant for a month that has ended. Running it again issues only the missing ones. */
  /** A credit note gives money back to the merchant against an invoice; a second person approves it. */
  /**
   * The invoice as the Egyptian Tax Authority's document (v1.0). Sending it needs the company's
   * ETA client id and secret and a signing token; until then finance downloads this file.
   */
  // ---------------------------------------------------------------- VAT and withholding tax

  /** VAT on sales minus VAT on purchases for a month, and withholding tax held for suppliers. */
  /** Pays the month's VAT: clears VAT on sales and on purchases, the difference from the bank. */
  // ---------------------------------------------------------------- suppliers and bills

  /** Approving books the bill: the expense, the VAT we can claim back, what we owe, the withholding tax we keep for the state. */
  // ---------------------------------------------------------------- bank statement matching

  /** Reads the bank's CSV (date, description, amount or debit and credit, reference) and matches what it can. */
  /** Same amount on the bank account in our books, within 5 days; a shared reference wins a tie. */
  /** The statement next to the books: what matched, what the bank shows that we did not book, and the other way round. */
  /** A line the bank shows that we never booked (bank charges, interest): book it and match it. */
  // ---------------------------------------------------------------- cash flow, profit, budgets

  /** Money in and out of the bank and the hub safes in a period, by what moved it. */
  /** Revenue (before VAT) and courier pay per merchant, per hub and per courier, from the parcels themselves. */
  // ---------------------------------------------------------------- cash limits

  /** Alerts when a courier holds more cash than allowed, or a hub safe holds too much; closes them when back under. */
  async cashLimitCheck() {
    const s = await this.settings.all();
    const [cash, safes] = await Promise.all([
      partyBalances(this.prisma, ACCOUNTS.COURIER_CASH.code),
      partyBalances(this.prisma, ACCOUNTS.HUB_SAFE.code),
    ]);
    let raised = 0;
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...cash.keys()] } },
          select: { id: true, name: true, agentId: true, hubId: true },
        })
      ).map((u) => [u.id, u]),
    );
    for (const [id, amount] of cash) {
      if (amount > s['cash.courier_limit']) {
        const u = users.get(id);
        await openAlert(this.prisma, {
          kind: 'CASH_LIMIT_COURIER',
          entity: 'user',
          entityId: id,
          agentId: u?.agentId ?? null,
          hubId: u?.hubId ?? null,
          severity: 'high',
          message: `${u?.name ?? 'A courier'} holds ${formatEgp(amount)}, over the ${formatEgp(s['cash.courier_limit'])} limit`,
        });
        raised++;
      } else
        await resolveAlerts(
          this.prisma,
          'user',
          id,
          ['CASH_LIMIT_COURIER'],
          undefined,
          'Back under the limit',
        );
    }
    const hubs = new Map(
      (await this.prisma.hub.findMany({ select: { id: true, name: true } })).map((h) => [
        h.id,
        h.name,
      ]),
    );
    for (const [id, amount] of safes) {
      if (amount > s['cash.safe_limit']) {
        await openAlert(this.prisma, {
          kind: 'CASH_LIMIT_SAFE',
          entity: 'hub',
          entityId: id,
          hubId: id,
          severity: 'high',
          message: `${hubs.get(id) ?? 'A hub'} safe holds ${formatEgp(amount)}, over the ${formatEgp(s['cash.safe_limit'])} limit. Deposit it in the bank`,
        });
        raised++;
      } else
        await resolveAlerts(
          this.prisma,
          'hub',
          id,
          ['CASH_LIMIT_SAFE'],
          undefined,
          'Back under the limit',
        );
    }
    return { raised };
  }

  // ---------------------------------------------------------------- agent advances

  /** How much an agent may take now: a share of this month's settlement so far, less advances already taken. */
  async advanceRoom(agentId: string) {
    const s = await this.settings.all();
    const month = todayInCairo().slice(0, 7);
    const so = await this.finance.computeSettlement(this.prisma, agentId, month);
    const taken = await this.prisma.agentAdvance.aggregate({
      where: {
        agentId,
        status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PAID'] },
        settlementId: null,
      },
      _sum: { amount: true },
    });
    const cap = Math.max(0, applyBp(Math.max(0, so.total), s['agents.advance_max_bp']));
    return {
      month,
      earnedSoFar: so.total,
      cap,
      taken: taken._sum.amount ?? 0,
      available: Math.max(0, cap - (taken._sum.amount ?? 0)),
    };
  }

  async requestAdvance(agentId: string, body: unknown, user: SessionUser) {
    const d = parse(AdvanceInput, body);
    const room = await this.advanceRoom(agentId);
    if (d.amount > room.available)
      throw new DomainError('too_much', `You can take up to ${formatEgp(room.available)} now`, 422);
    return this.prisma.tx(async (tx) =>
      tx.agentAdvance.create({
        data: {
          code: await nextCode(tx, 'money_seq', 'AV'),
          agentId,
          amount: d.amount,
          note: d.note,
          requestedById: user.id,
        },
      }),
    );
  }

  async advances(agentId?: string) {
    const rows = await this.prisma.agentAdvance.findMany({
      where: agentId ? { agentId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const agents = new Map(
      (await this.prisma.agent.findMany({ select: { id: true, name: true } })).map((a) => [
        a.id,
        a.name,
      ]),
    );
    return rows.map((r) => ({ ...r, agentName: agents.get(r.agentId) ?? '' }));
  }

  async decideAdvance(id: string, approve: boolean, user: SessionUser) {
    const a = await this.prisma.agentAdvance.findUnique({ where: { id } });
    if (!a) throw notFound('Advance');
    secondPerson(a.requestedById, user);
    const r = await this.prisma.agentAdvance.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: user.id },
    });
    if (r.count !== 1)
      throw new DomainError('bad_status', 'This advance is not waiting for approval', 409);
    await this.audit(
      this.prisma,
      user,
      approve ? 'ADVANCE_APPROVED' : 'ADVANCE_REJECTED',
      'agent_advance',
      id,
      { amount: a.amount },
    );
  }

  /** Paying an advance: the agent now owes it back, so it comes off their month end payment. */
  async payAdvance(id: string, user: SessionUser) {
    await this.prisma.tx(async (tx) => {
      const a = await tx.agentAdvance.findUnique({ where: { id } });
      if (!a || a.status !== 'APPROVED')
        throw new DomainError('bad_status', 'Approve the advance before paying it', 409);
      await tx.agentAdvance.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await post(tx, {
        memo: `Advance ${a.code} to agent`,
        source: 'AGENT_ADVANCE',
        key: `AGENT_ADVANCE:${a.id}`,
        userId: user.id,
        lines: [
          {
            account: ACCOUNTS.AGENT_PAYABLE.code,
            party: { type: 'AGENT', id: a.agentId },
            debit: a.amount,
          },
          { account: ACCOUNTS.BANK.code, credit: a.amount },
        ],
      });
      await this.audit(tx, user, 'ADVANCE_PAID', 'agent_advance', id, { amount: a.amount });
    });
  }
}
