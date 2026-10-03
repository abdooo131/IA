import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JournalType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashoutService } from './cashout.service';
import { LedgerService } from './ledger.service';
import { ACC, AdjustmentKind, deposit, DepositKind, merchantAdjustment, reversal } from './posting';

const REVERSIBLE: JournalType[] = ['MERCHANT_ADJUSTMENT', 'CASH_DEPOSIT'];

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly cashouts: CashoutService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async overview(ctx: RequestContext) {
    return this.prisma.withContext(ctx, async (tx) => {
      const balances = await this.ledger.accountBalances(tx);
      const by = (code: string) => balances.find((b) => b.code === code)?.balance ?? 0;
      const tz = await this.config.getString('finance.timezone', tx);
      const [{ monthStart }] = await tx.$queryRaw<{ monthStart: Date }[]>`
        SELECT (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS "monthStart"`;
      const month = await this.ledger.accountBalances(tx, undefined, monthStart);
      const revenueMtd = month.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + a.balance, 0);
      const expensesMtd = month.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + a.balance, 0);
      const [pendingCashouts, unsettled, runs] = await Promise.all([
        tx.cashoutRequest.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true }, _count: true }),
        tx.order.count({ where: { settledAt: null, status: { in: ['DELIVERED', 'RETURNED', 'UNSUCCESSFUL'] } } }),
        tx.settlementRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 }),
      ]);
      return {
        cashWithDrivers: by(ACC.CASH_WITH_DRIVERS),
        fawryReceivable: by(ACC.FAWRY_RECEIVABLE),
        bank: by(ACC.BANK),
        merchantWallets: by(ACC.MERCHANT_WALLETS),
        codAwaitingSettlement: by(ACC.COD_AWAITING_SETTLEMENT),
        vatPayable: by(ACC.VAT_PAYABLE),
        revenueMtd,
        profitMtd: revenueMtd - expensesMtd,
        pendingCashouts: { count: pendingCashouts._count, amount: pendingCashouts._sum.amount ?? 0 },
        unsettledOrders: unsettled,
        lastRuns: runs,
      };
    });
  }

  async recordDeposit(ctx: RequestContext, input: { kind: DepositKind; amount: number; reference: string; depositedAt?: Date; note?: string }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const ref = input.reference.trim().toUpperCase();
      const dup = await tx.cashDeposit.findUnique({ where: { reference: ref } });
      // Fraud rule 11.2: the same Fawry / bank reference can never be used twice.
      if (dup) throw new ConflictException(`Reference ${ref} was already recorded on ${dup.createdAt.toISOString().slice(0, 10)}`);
      const memo = `${input.kind} ${ref}`;
      const { journal } = await this.ledger.post(tx, {
        type: 'CASH_DEPOSIT',
        description: input.note ? `${memo}: ${input.note}` : memo,
        idempotencyKey: `deposit:${ref}`,
        lines: deposit(input.kind, input.amount, memo),
        referenceType: 'deposit',
        referenceId: ref,
        occurredAt: input.depositedAt ?? new Date(),
        createdById: ctx.userId,
      });
      const row = await tx.cashDeposit.create({
        data: { kind: input.kind, reference: ref, amount: input.amount, depositedAt: input.depositedAt ?? new Date(), note: input.note ?? null, journalId: journal.id, recordedById: ctx.userId },
      });
      await this.audit.record(tx, ctx, { action: 'finance.deposit', entityType: 'cash_deposit', entityId: row.id, after: { ...row, journalId: String(journal.id) } });
      return row;
    });
  }

  listDeposits(ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) => tx.cashDeposit.findMany({ orderBy: { depositedAt: 'desc' }, take: 200 }));
  }

  async adjustMerchant(ctx: RequestContext, input: { merchantId: string; kind: AdjustmentKind; amount: number; reason: string; orderId?: string | null; idempotencyKey?: string }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
      if (!merchant) throw new NotFoundException('Merchant not found');
      const label = input.kind === 'COMPENSATION' ? 'Compensation' : 'Deduction';
      const { journal, created } = await this.ledger.post(tx, {
        type: 'MERCHANT_ADJUSTMENT',
        description: `${label}: ${input.reason}`,
        idempotencyKey: input.idempotencyKey ?? `adjust:${randomUUID()}`,
        lines: merchantAdjustment(input.kind, input.merchantId, input.amount, `${label}: ${input.reason}`, input.orderId),
        merchantId: input.merchantId,
        orderId: input.orderId ?? null,
        createdById: ctx.userId,
      });
      if (created) {
        await this.audit.record(tx, ctx, { action: 'finance.merchant_adjustment', entityType: 'journal_entry', entityId: String(journal.id), merchantId: input.merchantId, after: { kind: input.kind, amount: input.amount }, reason: input.reason });
      }
      return journal;
    });
  }

  async reverse(ctx: RequestContext, journalId: bigint, reason: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const original = await tx.journalEntry.findUnique({ where: { id: journalId }, include: { lines: true } });
      if (!original) throw new NotFoundException('Journal not found');
      if (!REVERSIBLE.includes(original.type)) {
        throw new BadRequestException('Only adjustments and deposits can be reversed; order money follows the order status');
      }
      const already = await tx.journalEntry.findUnique({ where: { reversesId: journalId } });
      if (already) throw new ConflictException('This journal was already reversed');
      const { journal } = await this.ledger.post(tx, {
        type: 'REVERSAL',
        description: `Reversal of #${journalId}: ${reason}`,
        idempotencyKey: `reverse:${journalId}`,
        lines: reversal(original.lines),
        merchantId: original.merchantId,
        orderId: original.orderId,
        reversesId: journalId,
        createdById: ctx.userId,
      });
      await this.audit.record(tx, ctx, { action: 'finance.reverse', entityType: 'journal_entry', entityId: String(journal.id), merchantId: original.merchantId, after: { reverses: String(journalId) }, reason });
      return journal;
    });
  }

  async journals(ctx: RequestContext, q: { type?: string; merchantId?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const where: Prisma.JournalEntryWhereInput = {
        type: (q.type as JournalType) || undefined,
        merchantId: q.merchantId || undefined,
        occurredAt: { gte: q.from, lt: q.to },
      };
      const [total, items] = await Promise.all([
        tx.journalEntry.count({ where }),
        tx.journalEntry.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { lines: { orderBy: { id: 'asc' } } },
        }),
      ]);
      const reversed = await tx.journalEntry.findMany({ where: { reversesId: { in: items.map((i) => i.id) } }, select: { reversesId: true } });
      const reversedSet = new Set(reversed.map((r) => String(r.reversesId)));
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: items.map((j) => ({ ...j, reversed: reversedSet.has(String(j.id)), reversible: REVERSIBLE.includes(j.type) })),
      };
    });
  }

  async merchantWallets(ctx: RequestContext) {
    return this.prisma.withContext(ctx, async (tx) => {
      const merchants = await tx.merchant.findMany({ where: { archived: false }, orderBy: { nameEn: 'asc' } });
      const out = [];
      for (const m of merchants) {
        out.push({ id: m.id, code: m.code, nameEn: m.nameEn, nameAr: m.nameAr, cashoutFrequency: m.cashoutFrequency, ...(await this.cashouts.summary(tx, m.id)) });
      }
      return out;
    });
  }

  /** Wallet statement: every 2010 line for the merchant with a running balance (newest first). */
  async statement(ctx: RequestContext, merchantId: string, page = 1, pageSize = 50) {
    return this.prisma.withContext(ctx, async (tx) => {
      const offset = (page - 1) * pageSize;
      const rows = await tx.$queryRaw<
        { id: bigint; occurred_at: Date; journal_id: bigint; type: string; description: string; memo: string | null; debit: number; credit: number; running: bigint; order_id: string | null; tracking_number: string | null }[]
      >`
        SELECT * FROM (
          SELECT l.id, l.occurred_at, l.journal_id, j.type::text AS type, j.description, l.memo, l.debit, l.credit, l.order_id,
                 o.tracking_number,
                 sum(l.credit - l.debit) OVER (ORDER BY l.id) AS running
          FROM ledger_entries l
          JOIN journal_entries j ON j.id = l.journal_id
          LEFT JOIN orders o ON o.id = l.order_id
          WHERE l.account_code = ${ACC.MERCHANT_WALLETS} AND l.merchant_id = ${merchantId}::uuid
        ) s ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`;
      const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM ledger_entries WHERE account_code = ${ACC.MERCHANT_WALLETS} AND merchant_id = ${merchantId}::uuid`;
      return {
        total: Number(count),
        page,
        pageSize,
        items: rows.map((r) => ({
          id: String(r.id),
          occurredAt: r.occurred_at,
          journalId: String(r.journal_id),
          type: r.type,
          description: r.memo ?? r.description,
          amount: r.credit - r.debit,
          balanceAfter: Number(r.running),
          orderId: r.order_id,
          trackingNumber: r.tracking_number,
        })),
      };
    });
  }
}
