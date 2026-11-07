import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  bankMatching,
  drillReport,
  ledgerLinesList,
  markPayoutsPaid,
  matchBankLines,
  payoutRun,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  addDays,
  bankMatchManySchema,
  cairoDay,
  DRILL_REPORTS,
  type DrillReport,
  isCalendarDay,
  type LedgerLinesQuery,
  ledgerLinesQuerySchema,
  type ListQuery,
  listQuerySchema,
  payoutsMarkPaidSchema,
  type ReportFilter,
  reportFilterSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { assertMerchant, assertStore } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { reportPdf } from './report-pdf';
import { scopeOf } from './views.controller';

const drillLinesQuerySchema = listQuerySchema
  .merge(ledgerLinesQuerySchema)
  .extend({ report: z.enum(DRILL_REPORTS).optional() });

/**
 * Accounting UX phase B: reports you can click into (with their PDF), the ledger lines behind
 * a report line, the bank matching screen, and the guided Pay merchants run.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class FinanceRunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private filterOf(q: ReportFilter, access: AccessProfile) {
    const today = cairoDay(this.clock.now());
    const from = q.from ?? `${today.slice(0, 8)}01`;
    const to = q.to ?? today;
    if (q.store) assertStore(access, q.store);
    if (q.merchant) assertMerchant(access, q.merchant);
    return {
      from,
      to,
      compare: q.compare,
      storeId: q.store,
      merchantId: q.merchant,
    };
  }

  private report(name: string): DrillReport {
    if (!DRILL_REPORTS.includes(name as DrillReport))
      throw new NotFoundException({ error: 'report_not_found' });
    return name as DrillReport;
  }

  /** Profit and loss, balance sheet or trial balance by category, with a comparison. */
  @Get('reports/:report')
  drill(
    @Param('report') name: string,
    @Query(new ZodValidationPipe(reportFilterSchema)) q: ReportFilter,
    @CurrentAccess() access: AccessProfile,
  ) {
    return drillReport(this.prisma, this.report(name), this.filterOf(q, access));
  }

  /** The same report as a PDF, in English or Arabic. */
  @Get('reports/:report/export.pdf')
  @ApiQuery({ name: 'lang', required: false })
  async drillPdf(
    @Param('report') name: string,
    @Query(new ZodValidationPipe(reportFilterSchema.extend({ lang: z.enum(['en', 'ar']).optional() })))
    q: ReportFilter & { lang?: 'en' | 'ar' },
    @CurrentAccess() access: AccessProfile,
    @Res() res: Response,
  ) {
    const report = this.report(name);
    const filter = this.filterOf(q, access);
    const result = await drillReport(this.prisma, report, filter);
    const [store, merchant] = await Promise.all([
      filter.storeId
        ? this.prisma.darkStore.findUnique({ where: { id: filter.storeId } })
        : null,
      filter.merchantId
        ? this.prisma.merchant.findUnique({ where: { id: filter.merchantId } })
        : null,
    ]);
    const lang = q.lang ?? 'en';
    const pdf = await reportPdf(result, lang, {
      store: store ? (lang === 'ar' ? store.nameAr : store.nameEn) : null,
      merchant: merchant?.name ?? null,
    });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${report.replace(/_/g, '-')}-${result.to}-${lang}.pdf"`,
    );
    res.setHeader('cache-control', 'private, no-store');
    res.send(pdf);
  }

  /**
   * The ledger lines behind a report line (an account, a wallet group, income and costs, or
   * money) as a list view: filters, grouping, totals and paging like every list.
   */
  @Get('ledger-lines')
  lines(
    @Query(new ZodValidationPipe(drillLinesQuerySchema))
    q: ListQuery & LedgerLinesQuery & { report?: DrillReport },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (q.store && q.store !== 'none') assertStore(access, q.store);
    if (q.merchant && q.merchant !== 'none') assertMerchant(access, q.merchant);
    return ledgerLinesList(this.prisma, q, q, scopeOf(user, access), this.clock.now());
  }

  /** The bank matching screen of one bank account. */
  @Get('bank-matching/:accountId')
  @ApiQuery({ name: 'statement', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'q', required: false })
  matching(
    @Param('accountId') accountId: string,
    @Query('statement') statement?: string,
    @Query('month') month?: string,
    @Query('q') q?: string,
  ) {
    return bankMatching(this.prisma, {
      accountId,
      statementId: statement || undefined,
      month: month || undefined,
      q: q?.slice(0, 100) || undefined,
    });
  }

  /** Matches one bank line to one or several ledger lines adding up to exactly its amount. */
  @Post('bank-lines/:id/match-many')
  async matchMany(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bankMatchManySchema)) body: z.infer<typeof bankMatchManySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const line = await matchBankLines(this.prisma, {
      bankLineId: id,
      ledgerLineIds: body.ledgerLineIds,
      actorUserId: user.sub,
    });
    return { id: line.id, status: line.status };
  }

  /** Where today's Pay merchants run stands (read from the payouts themselves). */
  @Get('payouts/run')
  @ApiQuery({ name: 'cutoffDay', required: false, description: 'Cairo day, default yesterday' })
  run(@CurrentUser() user: AccessTokenClaims, @Query('cutoffDay') cutoffDay?: string) {
    const now = this.clock.now();
    const today = cairoDay(now);
    const day =
      cutoffDay && isCalendarDay(cutoffDay) && cutoffDay <= today ? cutoffDay : addDays(today, -1);
    return payoutRun(this.prisma, { userId: user.sub, cutoffDay: day, now });
  }

  /** Marks the chosen payouts paid with one bank reference and day, one transaction each. */
  @Post('payouts/run/mark-paid')
  markPaid(
    @Body(new ZodValidationPipe(payoutsMarkPaidSchema)) body: z.infer<typeof payoutsMarkPaidSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return markPayoutsPaid(this.prisma, { ...body, actorUserId: user.sub });
  }
}
