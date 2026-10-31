import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  accountStatement,
  balanceSheet,
  chartOfAccounts,
  createAccount,
  DomainError,
  moneyAccounts,
  profitAndLoss,
  recordCapital,
  recordExpense,
  recordJournalEntry,
  recordOtherIncome,
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
import { CurrentUser, Roles } from '../auth/decorators';
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

/** The company books: chart of accounts, money movements and the accountant's reports. */
@ApiTags('finance')
@ApiBearerAuth()
@Roles('admin', 'finance')
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
    return voucher(await recordExpense(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Post('capital')
  async capital(
    @Body(new ZodValidationPipe(capitalSchema)) body: z.infer<typeof capitalSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return voucher(await recordCapital(this.prisma, { ...body, actorUserId: user.sub }));
  }

  @Post('other-income')
  async otherIncome(
    @Body(new ZodValidationPipe(otherIncomeSchema)) body: z.infer<typeof otherIncomeSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return voucher(await recordOtherIncome(this.prisma, { ...body, actorUserId: user.sub }));
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
  profit(@Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to, this.clock.now(), 30);
    return profitAndLoss(this.prisma, range.from, range.to);
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
