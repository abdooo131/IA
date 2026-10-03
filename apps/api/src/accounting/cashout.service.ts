import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CashoutMethod } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { ConfigService } from '../config/config.service';
import { PrismaService, SYSTEM_CONTEXT, Tx } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { PAYOUT, PayoutAdapter } from './payout.adapter';
import { cashoutFee, CashoutFeeConfig, cashoutPaid } from './posting';

export function maskIban(iban: string) {
  return `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;
}

@Injectable()
export class CashoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(PAYOUT) private readonly payout: PayoutAdapter,
  ) {}

  async feeConfig(tx?: Tx): Promise<CashoutFeeConfig & { minAmount: number }> {
    const c = await this.config.getMany(
      ['merchant.cashout_fee_bank', 'merchant.cashout_fee_fawry_account_bp', 'merchant.cashout_fee_fawry_card_bp', 'merchant.min_cashout_amount'],
      tx,
    );
    return {
      bankFlat: c['merchant.cashout_fee_bank'] as number,
      fawryAccountBp: c['merchant.cashout_fee_fawry_account_bp'] as number,
      fawryCardBp: c['merchant.cashout_fee_fawry_card_bp'] as number,
      minAmount: c['merchant.min_cashout_amount'] as number,
    };
  }

  /** Balance, money on its way in, and what can be cashed out right now. */
  async summary(tx: Tx, merchantId: string) {
    const [balance, pendingCashouts, pendingSettlement] = await Promise.all([
      this.ledger.merchantBalance(tx, merchantId),
      this.ledger.pendingCashouts(tx, merchantId),
      this.ledger.pendingSettlement(tx, merchantId),
    ]);
    return { balance, pendingCashouts, pendingSettlement, available: Math.max(0, balance - pendingCashouts) };
  }

  async request(ctx: RequestContext, merchantId: string, input: { amount: number; method: CashoutMethod; destination?: string | null }, auto = false) {
    return this.prisma.withContext(ctx, async (tx) => {
      // Serialize requests per merchant so two clicks cannot both pass the balance check.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR UPDATE`;
      const cfg = await this.feeConfig(tx);
      const { available, balance } = await this.summary(tx, merchantId);
      if (balance < 0) throw new BadRequestException('Your wallet is negative, cashouts are paused until it is positive again');
      if (input.amount < cfg.minAmount) throw new BadRequestException(`Minimum cashout is ${cfg.minAmount / 100} EGP`);
      if (input.amount > available) throw new BadRequestException(`You can cash out up to ${available / 100} EGP right now`);
      const fee = cashoutFee(input.method, input.amount, cfg);
      if (input.amount - fee <= 0) throw new BadRequestException('The amount must be larger than the cashout fee');

      let destination = input.destination?.trim() ?? '';
      if (input.method === 'BANK') {
        const bank = await tx.merchantBankDetails.findUnique({ where: { merchantId } });
        if (!bank) throw new BadRequestException('Add your bank details before requesting a bank cashout');
        destination = `${bank.bankName} ${maskIban(bank.iban)}`;
      } else if (!/^(\+?20)?0?1[0125]\d{8}$|^\d{16}$/.test(destination.replace(/\s/g, ''))) {
        throw new BadRequestException('Enter the Fawry mobile number or the 16 digit Yellow Card number');
      }

      const req = await tx.cashoutRequest.create({
        data: { merchantId, amount: input.amount, fee, netAmount: input.amount - fee, method: input.method, destination, auto, requestedById: ctx.userId },
      });
      await this.audit.record(tx, ctx, { action: 'cashout.request', entityType: 'cashout_request', entityId: req.id, merchantId, after: req });
      return req;
    });
  }

  quote(method: CashoutMethod, amount: number) {
    return this.feeConfig().then((cfg) => {
      const fee = cashoutFee(method, amount, cfg);
      return { amount, fee, net: amount - fee, minAmount: cfg.minAmount };
    });
  }

  list(ctx: RequestContext, q: { status?: string; merchantId?: string }) {
    return this.prisma.withContext(ctx, (tx) =>
      tx.cashoutRequest.findMany({
        where: { status: (q.status as never) || undefined, merchantId: q.merchantId || undefined },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { merchant: { select: { nameEn: true, nameAr: true, code: true } } },
      }),
    );
  }

  /** Finance approves: pays through the payout adapter, then posts the ledger in the same transaction. */
  async approve(ctx: RequestContext, id: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashout_requests WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Cashout not found');
      const req = await tx.cashoutRequest.findUniqueOrThrow({ where: { id } });
      if (req.status !== 'PENDING') throw new ConflictException(`Cashout is already ${req.status.toLowerCase()}`);
      const balance = await this.ledger.merchantBalance(tx, req.merchantId);
      if (balance < req.amount) throw new BadRequestException('Merchant balance is lower than this cashout');

      const { reference } = await this.payout.pay({ idempotencyKey: req.id, method: req.method, destination: req.destination, amount: req.netAmount });
      const { journal } = await this.ledger.post(tx, {
        type: 'MERCHANT_CASHOUT',
        description: `Cashout ${req.method} ${reference}`,
        idempotencyKey: `cashout:${req.id}`,
        lines: cashoutPaid(req.merchantId, req.amount, req.fee),
        merchantId: req.merchantId,
        referenceType: 'cashout_request',
        referenceId: req.id,
        createdById: ctx.userId,
      });
      const paid = await tx.cashoutRequest.update({
        where: { id },
        data: { status: 'PAID', payoutReference: reference, journalId: journal.id, decidedById: ctx.userId, decidedAt: new Date() },
      });
      await this.audit.record(tx, ctx, { action: 'cashout.pay', entityType: 'cashout_request', entityId: id, merchantId: req.merchantId, before: { status: 'PENDING' }, after: { status: 'PAID', reference } });
      return paid;
    });
  }

  async reject(ctx: RequestContext, id: string, reason: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const req = await tx.cashoutRequest.findUnique({ where: { id } });
      if (!req) throw new NotFoundException('Cashout not found');
      if (req.status !== 'PENDING') throw new ConflictException(`Cashout is already ${req.status.toLowerCase()}`);
      const done = await tx.cashoutRequest.update({ where: { id }, data: { status: 'REJECTED', rejectReason: reason, decidedById: ctx.userId, decidedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: 'cashout.reject', entityType: 'cashout_request', entityId: id, merchantId: req.merchantId, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason });
      return done;
    });
  }

  /** Called by the cash cycle: opens a bank cashout for the full available balance on each merchant's cashout day. */
  async createDueAutoCashouts(asOf: Date, frequencyDays: Record<string, number>): Promise<number> {
    const merchants = await this.prisma.asSystem((tx) => tx.merchant.findMany({ where: { archived: false }, include: { bankDetails: true } }));
    const cfg = await this.feeConfig();
    let created = 0;
    for (const m of merchants) {
      const days = frequencyDays[m.cashoutFrequency] ?? 7;
      const due = !m.lastAutoCashoutAt || asOf.getTime() - m.lastAutoCashoutAt.getTime() >= days * 86400_000 - 3600_000;
      if (!due || !m.bankDetails) continue;
      const { available, balance } = await this.prisma.asSystem((tx) => this.summary(tx, m.id));
      await this.prisma.asSystem((tx) => tx.merchant.update({ where: { id: m.id }, data: { lastAutoCashoutAt: asOf } }));
      if (balance < 0 || available < cfg.minAmount || available <= cfg.bankFlat) continue;
      await this.request(SYSTEM_CONTEXT, m.id, { amount: available, method: 'BANK' }, true);
      created++;
    }
    return created;
  }
}
