import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@shiply/db';
import { parseEgp } from '@shiply/shared';
import { AuditService, DB, NeedAccess, parse } from '../platform';
import { MAX_PIASTRES, egp } from './amount';
import { assertCanPay } from './cash.service';
import { LedgerService, type CompanyKey } from './ledger.service';

const company = z.enum(['shiply_now', 'shiply']);
const vat = z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  if (v === undefined || v === '' || v === 0 || v === '0') return 0;
  try {
    const p = parseEgp(v);
    if (p < 0 || p > MAX_PIASTRES) throw new Error('range');
    return p;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'vat' });
    return z.NEVER;
  }
});
const BillBody = z.object({
  companyKey: company,
  payee: z.string().trim().min(1).max(200),
  supplierRef: z.string().trim().max(60).optional(),
  number: z.string().trim().min(1).max(60),
  date: z.coerce.date(),
  dueDate: z.coerce.date(),
  amount: egp,
  vat,
  accountCode: z.string().regex(/^\d{4}$/),
  costCentreId: z.string().optional(),
});
const ExpenseBody = z.object({
  companyKey: company,
  date: z.coerce.date(),
  accountCode: z.string().regex(/^\d{4}$/),
  amount: egp,
  vat,
  costCentreId: z.string().optional(),
  fromHolderId: z.string().min(1),
  note: z.string().trim().min(1).max(500),
});

/** Supplier bills (second person approval) and day to day expenses. */
@Controller('money')
export class SpendingController {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async expenseAccount(code: string) {
    const a = await this.db.account.findUnique({ where: { code } });
    if (!a?.active || a.type !== 'expense') throw new HttpException({ error: 'not_an_expense_account' }, 400);
  }

  @Get('bills')
  @NeedAccess('accounting', 'view')
  bills(@Query('status') status?: string) {
    return this.db.bill.findMany({ where: status ? { status } : {}, orderBy: { dueDate: 'asc' }, take: 500 });
  }

  @Post('bills')
  @NeedAccess('accounting', 'use')
  async createBill(@Body() body: unknown, @Req() req: Request) {
    const b = parse(BillBody, body);
    await this.expenseAccount(b.accountCode);
    return this.db.$transaction(async (tx) => {
      const bill = await tx.bill.create({ data: { ...b, preparedById: req.user!.id } });
      await this.audit.record(tx, { userId: req.user!.id, action: 'bill.prepared', entity: 'bill', entityId: bill.id, after: bill });
      return bill;
    });
  }

  /** Approval books the cost and what we owe the supplier. */
  @Post('bills/:id/approve')
  @HttpCode(200)
  @NeedAccess('accounting', 'manage')
  approveBill(@Param('id') id: string, @Req() req: Request) {
    return this.db.$transaction(async (tx) => {
      const b = await tx.bill.findUnique({ where: { id } });
      if (!b) throw new HttpException({ error: 'not_found' }, 404);
      if (b.preparedById === req.user!.id) throw new HttpException({ error: 'own_bill' }, 403);
      const { count } = await tx.bill.updateMany({ where: { id, status: 'draft' }, data: { status: 'approved', approvedById: req.user!.id } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const supplier = { partyType: 'supplier' as const, partyId: b.supplierRef ?? `payee:${b.payee}` };
      const lines = [{ accountCode: b.accountCode, debit: b.amount, credit: 0, costCentreId: b.costCentreId }];
      if (b.vat) lines.push({ accountCode: '1401', debit: b.vat, credit: 0, costCentreId: null });
      await this.ledger.post(tx, {
        companyKey: b.companyKey as CompanyKey,
        date: b.date,
        memo: `Bill ${b.number} ${b.payee}`,
        sourceType: 'bill',
        sourceId: id,
        sourceKey: `bill:${id}`,
        createdById: req.user!.id,
        lines: [...lines, { accountCode: '2201', debit: 0, credit: b.amount + b.vat, costCentreId: null, ...supplier }],
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'bill.approved', entity: 'bill', entityId: id });
      return tx.bill.findUniqueOrThrow({ where: { id } });
    });
  }

  @Post('bills/:id/cancel')
  @HttpCode(200)
  @NeedAccess('accounting', 'use')
  async cancelBill(@Param('id') id: string, @Req() req: Request) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.bill.updateMany({ where: { id, status: 'draft' }, data: { status: 'cancelled' } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      await this.audit.record(tx, { userId: req.user!.id, action: 'bill.cancelled', entity: 'bill', entityId: id });
      return { ok: true };
    });
  }

  @Post('bills/:id/pay')
  @HttpCode(200)
  @NeedAccess('accounting', 'use')
  payBill(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    const { fromHolderId } = parse(z.object({ fromHolderId: z.string().min(1) }), body);
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.bill.updateMany({ where: { id, status: 'approved' }, data: { status: 'paid', paidFromHolderId: fromHolderId, paidAt: new Date() } });
      if (!count) throw new HttpException({ error: 'wrong_status' }, 409);
      const b = await tx.bill.findUniqueOrThrow({ where: { id } });
      const holder = await tx.cashHolder.findUnique({ where: { id: fromHolderId } });
      if (!holder?.active || holder.companyKey !== b.companyKey) throw new HttpException({ error: 'wrong_holder' }, 400);
      await assertCanPay(tx, this.ledger, holder, b.amount + b.vat);
      await this.ledger.post(tx, {
        companyKey: b.companyKey as CompanyKey,
        date: new Date(),
        memo: `Paid bill ${b.number} ${b.payee}`,
        sourceType: 'bill.paid',
        sourceId: id,
        sourceKey: `bill.paid:${id}`,
        createdById: req.user!.id,
        lines: [
          { accountCode: '2201', debit: b.amount + b.vat, credit: 0, partyType: 'supplier', partyId: b.supplierRef ?? `payee:${b.payee}` },
          { accountCode: holder.accountCode, debit: 0, credit: b.amount + b.vat, partyType: 'holder', partyId: holder.id },
        ],
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'bill.paid', entity: 'bill', entityId: id });
      return b;
    });
  }

  @Get('expenses')
  @NeedAccess('accounting', 'view')
  expenses() {
    return this.db.expense.findMany({ orderBy: { date: 'desc' }, take: 500 });
  }

  /** An expense is paid at once from a cash holder or the bank. */
  @Post('expenses')
  @NeedAccess('accounting', 'use')
  async createExpense(@Body() body: unknown, @Req() req: Request) {
    const e = parse(ExpenseBody, body);
    await this.expenseAccount(e.accountCode);
    return this.db.$transaction(async (tx) => {
      const holder = await tx.cashHolder.findUnique({ where: { id: e.fromHolderId } });
      if (!holder?.active || holder.companyKey !== e.companyKey) throw new HttpException({ error: 'wrong_holder' }, 400);
      await assertCanPay(tx, this.ledger, holder, e.amount + e.vat);
      const { fromHolderId, ...rest } = e;
      const expense = await tx.expense.create({ data: { ...rest, paidFromHolderId: fromHolderId, createdById: req.user!.id } });
      const lines = [{ accountCode: e.accountCode, debit: e.amount, credit: 0, costCentreId: e.costCentreId ?? null }];
      if (e.vat) lines.push({ accountCode: '1401', debit: e.vat, credit: 0, costCentreId: null });
      await this.ledger.post(tx, {
        companyKey: e.companyKey,
        date: e.date,
        memo: e.note,
        sourceType: 'expense',
        sourceId: expense.id,
        sourceKey: `expense:${expense.id}`,
        createdById: req.user!.id,
        lines: [...lines, { accountCode: holder.accountCode, debit: 0, credit: e.amount + e.vat, costCentreId: null, partyType: 'holder', partyId: holder.id } as never],
      });
      await this.audit.record(tx, { userId: req.user!.id, action: 'expense.created', entity: 'expense', entityId: expense.id, after: expense });
      return expense;
    });
  }
}
