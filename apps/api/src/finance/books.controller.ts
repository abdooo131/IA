import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  accountStatement,
  balanceSheet,
  chartOfAccounts,
  createAccount,
  DomainError,
  moneyAccounts,
  listCostCenters,
  profitAndLoss,
  profitByCostCenter,
  recordJournalEntry,
  submitCapitalIn,
  submitDrawings,
  submitExpense,
  submitOtherIncome,
  transferMoney,
  trialBalance,
  updateAccount,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  capitalSchema,
  createAccountSchema,
  entryNumber,
  expenseSchema,
  isCalendarDay,
  journalEntrySchema,
  moneyTransferSchema,
  otherIncomeSchema,
  updateAccountSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseBound, parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { cairoStamp, csv, egp } from './finance-csv';

/** What a posting answers: the entry and its voucher number. */
const voucher = (entry: { id: string; number: number }) => ({
  id: entry.id,
  number: entryNumber(entry.number),
});

/** Posted at once (with its voucher), or waiting for a second person (with the request). */
export const submitted = (
  result:
    | { status: 'posted'; entry: { id: string; number?: number } }
    | { status: 'pending'; request: { id: string } },
) =>
  result.status === 'posted'
    ? {
        status: 'posted' as const,
        id: result.entry.id,
        ...(result.entry.number ? { number: entryNumber(result.entry.number) } : {}),
      }
    : { status: 'pending' as const, requestId: result.request.id };

/** The company books: chart of accounts, money movements and the accountant's reports. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class BooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('accounts')
  @ApiQuery({ name: 'all', required: false, description: 'true includes closed accounts' })
  accounts(@Query('all') all?: string) {
    return chartOfAccounts(this.prisma, { includeInactive: all === 'true' });
  }

  /** Banks and cash boxes, for choosing where money comes from or goes to. */
  @Get('money-accounts')
  money() {
    return moneyAccounts(this.prisma);
  }

  @Post('accounts')
  async create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: z.infer<typeof createAccountSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const account = await createAccount(this.prisma, { ...body, actorUserId: user.sub });
    return { id: account.id, code: account.code };
  }

  @Patch('accounts/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: z.infer<typeof updateAccountSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const account = await updateAccount(this.prisma, {
      accountId: id,
      ...body,
      actorUserId: user.sub,
    });
    return { id: account.id, code: account.code, isActive: account.isActive };
  }

  @Get('accounts/:id/statement')
  @ApiQuery({ name: 'from', required: false, description: 'Cairo day, default 30 days ago' })
  @ApiQuery({ name: 'to', required: false, description: 'Cairo day, included, default today' })
  statement(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to, this.clock.now(), 30);
    return accountStatement(this.prisma, id, range.from, range.to);
  }

  @Get('accounts/:id/statement.csv')
  async statementCsv(
    @Res() res: Response,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = parseRange(from, to, this.clock.now(), 30);
    const s = await accountStatement(this.prisma, id, range.from, range.to);
    const body = csv(
      [
        'date_cairo',
        'voucher',
        'type',
        'reference',
        'memo',
        'against',
        'debit_egp',
        'credit_egp',
        'balance_egp',
      ],
      [
        [
          cairoStamp(range.from),
          null,
          'opening_balance',
          null,
          null,
          null,
          null,
          null,
          egp(s.openingPiastres),
        ],
        ...s.lines.map((l) => [
          cairoStamp(l.at),
          l.number,
          l.kind,
          l.reference ?? l.orderNumber,
          l.memo,
          l.against.map((a) => `${a.code} ${a.nameEn}`).join(' | '),
          l.debitPiastres ? egp(l.debitPiastres) : null,
          l.creditPiastres ? egp(l.creditPiastres) : null,
          egp(l.balancePiastres),
        ]),
        [
          cairoStamp(new Date(range.to.getTime() - 1)),
          null,
          'closing_balance',
          null,
          null,
          null,
          egp(s.totalDebitPiastres),
          egp(s.totalCreditPiastres),
          egp(s.closingPiastres),
        ],
      ],
    );
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="account-${s.account.code}-${cairoDay(range.from)}.csv"`,
    );
    res.send(body);
  }

  @Post('transfers')
  async transfer(
    @Body(new ZodValidationPipe(moneyTransferSchema)) body: z.infer<typeof moneyTransferSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return voucher(await transferMoney(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Post('expenses')
  async expense(
    @Body(new ZodValidationPipe(expenseSchema)) body: z.infer<typeof expenseSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitExpense(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Post('capital')
  async capital(
    @Body(new ZodValidationPipe(capitalSchema)) body: z.infer<typeof capitalSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { direction, ...rest } = body;
    const input = { ...rest, actorUserId: user.sub };
    return submitted(
      direction === 'in'
        ? await submitCapitalIn(this.prisma, input)
        : await submitDrawings(this.prisma, input),
    );
  }

  @Post('other-income')
  async otherIncome(
    @Body(new ZodValidationPipe(otherIncomeSchema)) body: z.infer<typeof otherIncomeSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitOtherIncome(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Post('journal-entries')
  async journal(
    @Body(new ZodValidationPipe(journalEntrySchema)) body: z.infer<typeof journalEntrySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return voucher(await recordJournalEntry(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Get('profit-and-loss')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'company', required: false, description: 'shiply_now or shiply; both when empty' })
  @ApiQuery({ name: 'costCenter', required: false, description: 'A cost center id' })
  profit(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('company') company?: string,
    @Query('costCenter') costCenter?: string,
  ) {
    const range = parseRange(from, to, this.clock.now(), 30);
    return profitAndLoss(this.prisma, range.from, range.to, {
      company: companyOf(company),
      costCenterId: costCenter || undefined,
    });
  }

  /** Profit per company and per cost center: the group's P&L combined or separated. */
  @Get('profit-and-loss/by-cost-center')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  profitByCenter(@Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to, this.clock.now(), 30);
    return profitByCostCenter(this.prisma, range.from, range.to);
  }

  @Get('cost-centers')
  costCenters() {
    return listCostCenters(this.prisma);
  }

  @Get('balance-sheet')
  @ApiQuery({ name: 'day', required: false, description: 'Cairo day, default today' })
  sheet(@Query('day') day?: string) {
    const at = day ?? cairoDay(this.clock.now());
    if (!isCalendarDay(at)) throw new DomainError('invalid_date', 400);
    return balanceSheet(this.prisma, at);
  }

  @Get('trial-balance')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  trial(@Query('from') from?: string, @Query('to') to?: string) {
    return trialBalance(this.prisma, parseBound(from, 'from'), parseBound(to, 'to'));
  }
}

function companyOf(value?: string): 'shiply_now' | 'shiply' | undefined {
  if (!value) return undefined;
  if (value === 'shiply_now' || value === 'shiply') return value;
  throw new DomainError('invalid_company', 400);
}
