import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { parse } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { CashoutService } from './cashout.service';
import { ExportService } from './export.service';
import { FinanceService } from './finance.service';
import { REPORT_KINDS, ReportsService } from './reports.service';
import { SettlementService } from './settlement.service';

const READ = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'FINANCE'] as const;
const WRITE = ['SUPER_ADMIN', 'FINANCE'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

@Controller('finance')
@UseInterceptors(NoStoreInterceptor)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly settlement: SettlementService,
    private readonly cashouts: CashoutService,
    private readonly reports: ReportsService,
    private readonly exports: ExportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  @Roles(...READ)
  overview(@Ctx() ctx: RequestContext) {
    return this.finance.overview(ctx);
  }

  @Get('accounts')
  @Roles(...READ)
  accounts(@Ctx() ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) => tx.ledgerAccount.findMany({ orderBy: { code: 'asc' } }));
  }

  /** Runs the midnight cash cycle now. asOf lets a demo settle as if it were a later time. */
  @Post('settlement/run')
  @Roles(...WRITE)
  run(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(z.object({ asOf: z.string().datetime().optional() }), body ?? {});
    return this.settlement.run({ asOf: b.asOf ? new Date(b.asOf) : undefined, triggeredBy: `manual:${ctx.userId}`, ctx });
  }

  @Get('settlement/runs')
  @Roles(...READ)
  runs() {
    return this.settlement.listRuns();
  }

  @Get('journals')
  @Roles(...READ)
  journals(@Ctx() ctx: RequestContext, @Query() q: unknown) {
    const p = parse(
      z.object({
        type: z.string().optional(),
        merchantId: z.string().uuid().optional(),
        from: day,
        to: day,
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
      q,
    );
    return this.finance.journals(ctx, {
      ...p,
      from: p.from ? new Date(`${p.from}T00:00:00Z`) : undefined,
      to: p.to ? new Date(new Date(`${p.to}T00:00:00Z`).getTime() + 86400_000) : undefined,
    });
  }

  @Post('journals/:id/reverse')
  @Roles(...WRITE)
  reverse(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid journal id');
    const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), body);
    return this.finance.reverse(ctx, BigInt(id), b.reason);
  }

  @Get('wallets')
  @Roles(...READ)
  wallets(@Ctx() ctx: RequestContext) {
    return this.finance.merchantWallets(ctx);
  }

  @Get('wallets/:merchantId/statement')
  @Roles(...READ)
  statement(@Ctx() ctx: RequestContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Query('page') page?: string) {
    return this.finance.statement(ctx, merchantId, Math.max(1, parseInt(page ?? '1', 10) || 1));
  }

  @Post('wallets/:merchantId/adjust')
  @Roles(...WRITE)
  adjust(@Ctx() ctx: RequestContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Body() body: unknown) {
    const b = parse(
      z.object({
        kind: z.enum(['COMPENSATION', 'DEDUCTION']),
        amount: z.number().int().positive(),
        reason: z.string().trim().min(3).max(300),
        orderId: z.string().uuid().optional().nullable(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      }),
      body,
    );
    return this.finance.adjustMerchant(ctx, { merchantId, ...b });
  }

  @Get('cashouts')
  @Roles(...READ)
  listCashouts(@Ctx() ctx: RequestContext, @Query('status') status?: string, @Query('merchantId') merchantId?: string) {
    return this.cashouts.list(ctx, { status, merchantId });
  }

  @Post('cashouts/:id/approve')
  @Roles(...WRITE)
  approve(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.cashouts.approve(ctx, id);
  }

  @Post('cashouts/:id/reject')
  @Roles(...WRITE)
  reject(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.cashouts.reject(ctx, id, parse(z.object({ reason: z.string().trim().min(3).max(300) }), body).reason);
  }

  @Get('deposits')
  @Roles(...READ)
  deposits(@Ctx() ctx: RequestContext) {
    return this.finance.listDeposits(ctx);
  }

  @Post('deposits')
  @Roles(...WRITE)
  recordDeposit(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(
      z.object({
        kind: z.enum(['DRIVER_TO_FAWRY', 'DRIVER_TO_BANK', 'FAWRY_SETTLEMENT']),
        amount: z.number().int().positive(),
        reference: z.string().trim().min(4).max(60),
        depositedAt: z.string().datetime().optional(),
        note: z.string().trim().max(300).optional(),
      }),
      body,
    );
    return this.finance.recordDeposit(ctx, { ...b, depositedAt: b.depositedAt ? new Date(b.depositedAt) : undefined });
  }

  @Get('reports/:kind')
  @Roles(...READ)
  report(@Ctx() ctx: RequestContext, @Param('kind') kind: string, @Query() q: unknown) {
    const k = parse(z.enum(REPORT_KINDS), kind);
    const p = parse(z.object({ from: day, to: day, asOf: day }), q);
    return this.prisma.withContext(ctx, (tx) => this.reports.build(tx, k, p), { timeout: 60000 });
  }

  @Post('exports')
  @Roles(...READ)
  requestExport(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const b = parse(
      z.object({ kind: z.enum(REPORT_KINDS), format: z.enum(['xlsx', 'pdf']), params: z.object({ from: day, to: day, asOf: day }).default({}) }),
      body,
    );
    return this.exports.request(ctx, b.kind, b.format, b.params);
  }

  @Get('exports')
  @Roles(...READ)
  listExports(@Ctx() ctx: RequestContext) {
    return this.exports.list(ctx);
  }

  @Get('exports/:id/download')
  @Roles(...READ)
  async download(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.exports.download(ctx, id);
    res.setHeader('Content-Type', f.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${f.fileName}"`);
    res.send(f.content);
  }
}
