import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient, Tx } from '@shiply/db';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { egp } from './amount';
import { assertCanPay } from './cash.service';
import { LedgerService, type CompanyKey } from './ledger.service';

const COMPANIES: CompanyKey[] = ['shiply_now', 'shiply'];

/** Merchant payouts: prepared, approved by a second person within the balance, then paid. */
@Controller('money/payouts')
export class PayoutsController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** What can still be paid out to a merchant from one company: balance less approved, unpaid payouts. */
  private async free(tx: Tx, merchantId: string, companyKey: CompanyKey, exceptId?: string) {
    const balance = -(await this.ledger.balance({ accountCode: '2101', partyType: 'merchant', partyId: merchantId, companyKey }, tx));
    const committed = await tx.payout.aggregate({ where: { merchantId, companyKey, status: 'approved', ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { amount: true } });
    return balance - (committed._sum.amount ?? 0);
  }

  @Get()
  @NeedAccess('accounting', 'view')
  list(@Query('status') status?: string) {
    return this.db.payout.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  @Post()
  @NeedAccess('accounting', 'use')
  async create(@Body() body: unknown, @Req() req: Request) {
    const p = parse(z.object({ merchantId: z.string().min(1), amount: egp, companyKey: z.enum(['shiply_now', 'shiply']).optional(), method: z.enum(['bank', 'cash']).default('bank') }), body);
    return this.db.$transaction(async (tx) => {
      // The company that holds the merchant's money, unless one is named.
      let companyKey = p.companyKey;
      if (!companyKey) {
        const frees = await Promise.all(COMPANIES.map(async (c) => [c, await this.free(tx, p.merchantId, c)] as const));
        companyKey = frees.sort((a, b) => b[1] - a[1])[0]![0];
      }
      if (p.amount > (await this.free(tx, p.merchantId, companyKey))) throw new HttpException({ error: 'over_balance' }, 409);
      const payout = await tx.payout.create({ data: { merchantId: p.merchantId, companyKey, amount: p.amount, method: p.method, preparedById: req.user!.id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'payout.prepared', entity: 'payout', entityId: payout.id, after: payout });
      return payout;
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @NeedAccess('accounting', 'manage')
  approve(@Param('id') id: string, @Req() req: Request) {
    return this.db.$transaction(async (tx) => {
      const p = await tx.payout.findUnique({ where: { id } });
      if (!p) throw new HttpException({ error: 'not_found' }, 404);
      if (p.preparedById === req.user!.id) throw new HttpException({ error: 'own_payout' }, 403);
      // One approval at a time per merchant, so two cannot together pass the balance.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.merchantId}))`;
      if (p.amount > (await this.free(tx, p.merchantId, p.companyKey as CompanyKey, id))) throw new HttpException({ error: 'over_balance' }, 409);
      const { count } = await tx.payout.updateMany({ where: { id, status: 'draft' }, data: { status: 'approved', approvedById: req.user!.id, approvedAt: new Date() } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      await this.audit.record(tx, { userId: req.user!.id, action: 'payout.approved', entity: 'payout', entityId: id });
      return tx.payout.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post(':id/paid')
  @HttpCode(200)
  @NeedAccess('accounting', 'use')
  paid(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ reference: z.string().trim().min(1).max(120), fromHolderId: z.string().min(1) }), body);
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.payout.updateMany({ where: { id, status: 'approved' }, data: { status: 'paid', reference: b.reference, paidById: req.user!.id, paidAt: new Date() } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const p = await tx.payout.findUniqueOrThrow({ where: { id } });
      const holder = await tx.cashHolder.findUnique({ where: { id: b.fromHolderId } });
      if (!holder?.active || holder.companyKey !== p.companyKey) throw new HttpException({ error: 'wrong_holder' }, 400);
      await assertCanPay(tx, this.ledger, holder, p.amount);
      await this.ledger.post(tx, {
        companyKey: p.companyKey as CompanyKey,
        date: new Date(),
        memo: `Payout ${b.reference}`,
        sourceType: 'payout',
        sourceId: id,
        sourceKey: `payout:${id}`,
        createdById: req.user!.id,
        lines: [
          { accountCode: '2101', debit: p.amount, credit: 0, partyType: 'merchant', partyId: p.merchantId },
          { accountCode: holder.accountCode, debit: 0, credit: p.amount, partyType: 'holder', partyId: holder.id },
        ],
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'payout.paid', entity: 'payout', entityId: id, after: { reference: b.reference } });
      return p;
    });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @NeedAccess('accounting', 'use')
  async cancel(@Param('id') id: string, @Req() req: Request) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.payout.updateMany({ where: { id, status: { in: ['draft', 'approved'] } }, data: { status: 'cancelled' } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      await this.audit.record(tx, { userId: req.user!.id, action: 'payout.cancelled', entity: 'payout', entityId: id });
      return { ok: true };
    });
  }
}
