import { Body, Controller, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  bookCorporateTax,
  comparativeStatements,
  corporateTaxEstimate,
  payrollForms,
  vatReturn,
  withholdingPayments,
  bookBankCharge,
  budgetVsActual,
  cashFlow,
  cashForecast,
  chartOfAccounts,
  closeYear,
  DomainError,
  ignoreBankLine,
  importStatement,
  journalLines,
  listStatements,
  matchBankLine,
  receiptPhotos,
  reconciliation,
  reopenBankLine,
  setBudget,
  trialBalance,
  vatReport,
  yearCloseStatus,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  addDays,
  bankIgnoreSchema,
  bankMatchSchema,
  budgetSchema,
  cairoDay,
  corporateTaxSchema,
  cairoDayStart,
  entryNumber,
  isCalendarDay,
  statementImportSchema,
  statementNumber,
  yearCloseSchema,
} from '@shiplynow/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { zip } from '../shopify/widget-kit';
import { PrismaService } from '../prisma/prisma.service';
import { csv, egp } from './finance-csv';
import { readSpreadsheet } from './spreadsheet';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A period of Cairo days from the query, a whole year by default. */
function days(from: string | undefined, to: string | undefined, today: string) {
  const start = from && isCalendarDay(from) ? from : `${today.slice(0, 4)}-01-01`;
  const end = to && isCalendarDay(to) ? to : today;
  if (end < start) throw new DomainError('invalid_date', 400);
  return { from: start, to: end };
}

/**
 * Bank reconciliation, VAT per month, budgets, cash flow and forecast, closing a year, and
 * the exports for the accountant and the auditor.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class PeriodController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ─── bank ───────────────────────────────────────────────────────────────────

  /** Body: the statement file itself (.xlsx or .csv). Answers its rows to choose columns from. */
  @Post('bank-statements/read')
  read(@Req() req: Request) {
    if (!Buffer.isBuffer(req.body)) throw new DomainError('file_empty', 400);
    const rows = readSpreadsheet(req.body);
    if (rows.length === 0) throw new DomainError('file_empty', 400);
    return { rows };
  }

  @Post('bank-statements')
  async importStatement(
    @Body(new ZodValidationPipe(statementImportSchema))
    body: z.infer<typeof statementImportSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const result = await importStatement(this.prisma, { ...body, actorUserId: user.sub });
    return {
      id: result.statement.id,
      number: statementNumber(result.statement.number),
      imported: result.imported,
      skipped: result.skipped,
      matched: result.matched,
    };
  }

  @Get('bank-statements')
  @ApiQuery({ name: 'accountId', required: false })
  statements(@Query('accountId') accountId?: string) {
    return listStatements(this.prisma, accountId || undefined);
  }

  @Get('bank-reconciliation/:accountId')
  @ApiQuery({ name: 'day', required: false })
  reconciliation(@Param('accountId') accountId: string, @Query('day') day?: string) {
    return reconciliation(this.prisma, { accountId, day: day || undefined });
  }

  @Post('bank-lines/:id/match')
  async match(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bankMatchSchema)) body: z.infer<typeof bankMatchSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const line = await matchBankLine(this.prisma, {
      bankLineId: id,
      ledgerLineId: body.ledgerLineId,
      actorUserId: user.sub,
    });
    return { id: line.id, status: line.status };
  }

  @Post('bank-lines/:id/ignore')
  async ignore(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bankIgnoreSchema)) body: z.infer<typeof bankIgnoreSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const line = await ignoreBankLine(this.prisma, {
      bankLineId: id,
      note: body.note,
      actorUserId: user.sub,
    });
    return { id: line.id, status: line.status };
  }

  @Post('bank-lines/:id/reopen')
  async reopen(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const line = await reopenBankLine(this.prisma, { bankLineId: id, actorUserId: user.sub });
    return { id: line.id, status: line.status };
  }

  @Post('bank-lines/:id/bank-charge')
  async bankCharge(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const result = await bookBankCharge(this.prisma, { bankLineId: id, actorUserId: user.sub });
    return result.status === 'posted'
      ? { status: 'posted', id: result.entry.id }
      : { status: 'pending', requestId: result.request.id };
  }

  // ─── reports ────────────────────────────────────────────────────────────────

  @Get('vat-report')
  @ApiQuery({ name: 'year', required: false })
  vat(@Query('year') year?: string) {
    return vatReport(
      this.prisma,
      year ? Number(year) : Number(cairoDay(this.clock.now()).slice(0, 4)),
    );
  }

  @Get('budgets')
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'storeId', required: false })
  budgets(@Query('month') month?: string, @Query('storeId') storeId?: string) {
    const m = month && MONTH.test(month) ? month : cairoDay(this.clock.now()).slice(0, 7);
    return budgetVsActual(this.prisma, { month: m, darkStoreId: storeId || undefined });
  }

  @Put('budgets')
  async setBudget(
    @Body(new ZodValidationPipe(budgetSchema)) body: z.infer<typeof budgetSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const row = await setBudget(this.prisma, { ...body, actorUserId: user.sub });
    return { id: row.id, amountPiastres: row.amountPiastres };
  }

  @Get('cash-flow')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  cashFlow(@Query('from') from?: string, @Query('to') to?: string) {
    return cashFlow(this.prisma, parseRange(from, to, this.clock.now(), 30));
  }

  @Get('cash-forecast')
  forecast() {
    return cashForecast(this.prisma, this.clock.now());
  }

  // ─── year end ───────────────────────────────────────────────────────────────

  @Get('year-close')
  years() {
    return yearCloseStatus(this.prisma, this.clock.now());
  }

  /** Closes a finished year into retained earnings: approvers only. */
  @Post('year-close')
  @Access('accounting', 'manage')
  async closeYear(
    @Body(new ZodValidationPipe(yearCloseSchema)) body: z.infer<typeof yearCloseSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const result = await closeYear(this.prisma, {
      year: body.year,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
    return {
      ...result,
      entryNumber: result.entryNumber ? entryNumber(result.entryNumber) : null,
    };
  }

  // ─── exports ────────────────────────────────────────────────────────────────

  /**
   * The general journal as CSV in the shape accounting programs import (Odoo, Zoho Books,
   * QuickBooks, Daftra): one row per line with date, voucher, account, debit and credit.
   */
  @Get('export/journal.csv')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async journalCsv(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const period = days(from, to, cairoDay(this.clock.now()));
    const body = await this.journalCsvBody(period);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="journal-${period.from}-${period.to}.csv"`,
    );
    res.send(body);
  }

  private async journalCsvBody(period: { from: string; to: string }) {
    const lines = await journalLines(this.prisma, period);
    return csv(
      [
        'Date',
        'Journal number',
        'Kind',
        'Description',
        'Account code',
        'Account name',
        'Account name (Arabic)',
        'Debit',
        'Credit',
        'Store',
        'Merchant',
      ],
      lines.map((l) => [
        l.day,
        entryNumber(l.number),
        l.kind,
        l.memo,
        l.code,
        l.nameEn,
        l.nameAr,
        l.debitPiastres ? egp(l.debitPiastres) : '',
        l.creditPiastres ? egp(l.creditPiastres) : '',
        l.store,
        l.merchant,
      ]),
    );
  }

  /**
   * Everything an auditor asks for, in one zip: the journal, the trial balance and the chart
   * of accounts for the period, the year's VAT, and every receipt photo named by its voucher.
   */
  @Get('export/audit-pack.zip')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async auditPack(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const period = days(from, to, cairoDay(this.clock.now()));
    const start = cairoDayStart(period.from);
    const end = cairoDayStart(addDays(period.to, 1));
    const [journal, trial, chart, vat, photos] = await Promise.all([
      this.journalCsvBody(period),
      trialBalance(this.prisma, start, end),
      chartOfAccounts(this.prisma, { includeInactive: true }),
      vatReport(this.prisma, Number(period.to.slice(0, 4))),
      receiptPhotos(this.prisma, period),
    ]);
    const folder = `audit-${period.from}-${period.to}`;
    const ext = (type: string) =>
      type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const seen = new Map<number, number>();
    const files = [
      { path: `${folder}/journal.csv`, data: Buffer.from(journal) },
      {
        path: `${folder}/trial-balance.csv`,
        data: Buffer.from(
          csv(
            ['Account code', 'Account name', 'Debit', 'Credit'],
            trial.rows.map((r) => [r.code, r.nameEn, egp(r.debitPiastres), egp(r.creditPiastres)]),
          ),
        ),
      },
      {
        path: `${folder}/chart-of-accounts.csv`,
        data: Buffer.from(
          csv(
            ['Code', 'Name', 'Name (Arabic)', 'Category', 'Group', 'Active', 'Balance now'],
            chart.map((a) => [
              a.code,
              a.nameEn,
              a.nameAr,
              a.category,
              a.groupCode,
              a.isActive ? 'yes' : 'no',
              egp(a.balancePiastres),
            ]),
          ),
        ),
      },
      {
        path: `${folder}/vat-${vat.year}.csv`,
        data: Buffer.from(
          csv(
            ['Month', 'VAT on our fees', 'VAT claimed back', 'Due', 'Paid'],
            vat.months.map((m) => [
              m.month,
              egp(m.outputPiastres),
              egp(m.inputPiastres),
              egp(m.duePiastres),
              egp(m.paidPiastres),
            ]),
          ),
        ),
      },
      ...photos.map((p) => {
        const n = (seen.get(p.number) ?? 0) + 1;
        seen.set(p.number, n);
        return {
          path: `${folder}/receipts/${entryNumber(p.number)}-${n}.${ext(p.content_type)}`,
          data: Buffer.from(p.data),
        };
      }),
    ];
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${folder}.zip"`);
    res.send(zip(files));
  }

  // ─── tax returns ────────────────────────────────────────────────────────────

  private month(month?: string) {
    if (month && MONTH.test(month)) return month;
    const today = cairoDay(this.clock.now());
    return addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  }

  @Get('tax-returns/vat')
  @ApiQuery({ name: 'month', required: false })
  vatReturn(@Query('month') month?: string) {
    return vatReturn(this.prisma, this.month(month));
  }

  private quarter(year?: string, quarter?: string) {
    const today = cairoDay(this.clock.now());
    return {
      year: year ? Number(year) : Number(today.slice(0, 4)),
      quarter: quarter ? Number(quarter) : Math.ceil(Number(today.slice(5, 7)) / 3),
    };
  }

  @Get('tax-returns/withholding')
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'quarter', required: false })
  withholding(@Query('year') year?: string, @Query('quarter') quarter?: string) {
    return withholdingPayments(this.prisma, this.quarter(year, quarter));
  }

  /** Form 41 lines: one row per payment, in the order the tax portal's sheet asks. */
  @Get('tax-returns/withholding.csv')
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'quarter', required: false })
  async withholdingCsv(
    @Res() res: Response,
    @Query('year') year?: string,
    @Query('quarter') quarter?: string,
  ) {
    const q = this.quarter(year, quarter);
    const rows = await withholdingPayments(this.prisma, q);
    this.sendCsv(
      res,
      `form41-${q.year}-Q${q.quarter}.csv`,
      csv(
        [
          'Tax registration number',
          'Name',
          'Date',
          'Amount before VAT',
          'Rate %',
          'Withheld',
          'Voucher',
        ],
        rows.map((r) => [
          r.taxId,
          r.supplier,
          r.day,
          egp(r.netPiastres),
          (r.rateBp / 100).toFixed(2),
          egp(r.whtPiastres),
          entryNumber(r.entryNumber),
        ]),
      ),
    );
  }

  @Get('tax-returns/payroll')
  @Access('accounting', 'view', { salaries: true })
  @ApiQuery({ name: 'month', required: false })
  async payroll(@Query('month') month?: string) {
    const forms = await payrollForms(this.prisma, this.month(month));
    return { ...forms, entryNumber: forms.entryNumber ? entryNumber(forms.entryNumber) : null };
  }

  /** Salary tax (kind "tax") or social insurance (kind "insurance") list for the month. */
  @Get('tax-returns/payroll.csv')
  @Access('accounting', 'view', { salaries: true })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'kind', required: false, enum: ['tax', 'insurance'] })
  async payrollCsv(
    @Res() res: Response,
    @Query('month') month?: string,
    @Query('kind') kind?: string,
  ) {
    const m = this.month(month);
    const forms = await payrollForms(this.prisma, m);
    if (kind === 'insurance')
      return this.sendCsv(
        res,
        `social-insurance-${m}.csv`,
        csv(
          [
            'Insurance number',
            'National ID',
            'Name',
            'Insured wage',
            'Employee share',
            'Company share',
            'Total',
          ],
          forms.rows.map((r) => [
            r.insuranceNumber ?? '',
            r.nationalId ?? '',
            r.name,
            egp(r.insuredWage),
            egp(r.siEmployee),
            egp(r.siEmployer),
            egp(r.siEmployee + r.siEmployer),
          ]),
        ),
      );
    this.sendCsv(
      res,
      `salary-tax-${m}.csv`,
      csv(
        [
          'National ID',
          'Name',
          'Gross',
          'Employee insurance',
          'Taxable',
          'Income tax',
          'Martyrs fund',
          'Net',
        ],
        forms.rows.map((r) => [
          r.nationalId ?? '',
          r.name,
          egp(r.gross),
          egp(r.siEmployee),
          egp(r.gross - r.siEmployee),
          egp(r.incomeTax),
          egp(r.martyrs),
          egp(r.net),
        ]),
      ),
    );
  }

  @Get('tax-returns/corporate')
  @ApiQuery({ name: 'year', required: false })
  corporate(@Query('year') year?: string) {
    return corporateTaxEstimate(
      this.prisma,
      year ? Number(year) : Number(cairoDay(this.clock.now()).slice(0, 4)) - 1,
    );
  }

  /** Books the year's company income tax before closing the year: approvers only. */
  @Post('tax-returns/corporate')
  @Access('accounting', 'manage')
  bookCorporate(
    @Body(new ZodValidationPipe(corporateTaxSchema)) body: z.infer<typeof corporateTaxSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return bookCorporateTax(this.prisma, { ...body, actorUserId: user.sub, now: this.clock.now() });
  }

  @Get('comparative-statements')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  compare(@Query('from') from?: string, @Query('to') to?: string) {
    return comparativeStatements(this.prisma, days(from, to, cairoDay(this.clock.now())));
  }

  private sendCsv(res: Response, name: string, body: string) {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.send(body);
  }
}
