import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  cancelPayout,
  createPayout,
  DomainError,
  financeWallets,
  listCashHandovers,
  listLedgerEntries,
  listPayouts,
  markPayoutPaid,
  merchantOwed,
  merchantStatement,
  payoutDueOn,
  payRiderBonus,
  recordAudit,
  recordBankDeposit,
  recordMerchantAdjustment,
  recordMerchantReceipt,
  reviewCashHandover,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  addDays,
  bankDepositSchema,
  cairoClock,
  cairoDay,
  cairoDayStart,
  createPayoutSchema,
  duePayoutsSchema,
  merchantAdjustmentSchema,
  merchantReceiptSchema,
  payoutCancelSchema,
  payoutPaidSchema,
  payoutScheduleSchema,
  reviewHandoverSchema,
  riderBonusPayoutSchema,
} from '@shiplynow/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseBound, parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { cairoStamp, csv, egp } from './finance-csv';

const HANDOVER_STATUSES = ['balanced', 'pending', 'written_off', 'charged_to_rider'] as const;
const PAYOUT_STATUSES = ['draft', 'paid', 'cancelled'] as const;
const pick = <T extends string>(list: readonly T[], value?: string) =>
  list.includes(value as T) ? (value as T) : undefined;

/** The end of a Cairo day: payouts cover everything posted up to then. */
const endOfDay = (day: string) => cairoDayStart(addDays(day, 1));

@ApiTags('finance')
@ApiBearerAuth()
@Roles('admin', 'finance')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Every wallet and the company books, plus what needs attention. */
  @Get('overview')
  overview() {
    return financeWallets(this.prisma);
  }

  @Get('handovers')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  handovers(@Query('status') status?: string, @Query('darkStoreId') darkStoreId?: string) {
    return listCashHandovers(this.prisma, {
      status: pick(HANDOVER_STATUSES, status),
      darkStoreId: darkStoreId || undefined,
    });
  }

  @Post('handovers/:id/review')
  review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewHandoverSchema)) body: z.infer<typeof reviewHandoverSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return reviewCashHandover(this.prisma, { handoverId: id, ...body, actorUserId: user.sub });
  }

  @Post('deposits')
  async deposit(
    @Body(new ZodValidationPipe(bankDepositSchema)) body: z.infer<typeof bankDepositSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const entry = await recordBankDeposit(this.prisma, { ...body, actorUserId: user.sub });
    return { id: entry.id };
  }

  @Get('payouts')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  payouts(@Query('status') status?: string, @Query('merchantId') merchantId?: string) {
    return listPayouts(this.prisma, {
      status: pick(PAYOUT_STATUSES, status),
      merchantId: merchantId || undefined,
    });
  }

  @Post('payouts')
  async createPayout(
    @Body(new ZodValidationPipe(createPayoutSchema)) body: z.infer<typeof createPayoutSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const payout = await createPayout(this.prisma, {
      merchantId: body.merchantId,
      cutoffAt: endOfDay(body.cutoffDay),
      note: body.note,
      actorUserId: user.sub,
    });
    return { id: payout.id, amountPiastres: payout.amountPiastres };
  }

  /**
   * Prepares drafts for every merchant whose schedule is due today (Cairo), up to the end
   * of the given day. Merchants with nothing owed or an open draft are listed as skipped.
   */
  @Post('payouts/due')
  async createDue(
    @Body(new ZodValidationPipe(duePayoutsSchema)) body: z.infer<typeof duePayoutsSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const weekday = cairoClock(this.clock.now()).weekday;
    const merchants = await this.prisma.merchant.findMany({ where: { isActive: true } });
    const created: { merchantId: string; amountPiastres: number }[] = [];
    const skipped: { merchantId: string; reason: string }[] = [];
    for (const m of merchants) {
      if (!payoutDueOn(m.payoutSchedule, weekday)) {
        skipped.push({ merchantId: m.id, reason: 'not_due_today' });
        continue;
      }
      try {
        const p = await createPayout(this.prisma, {
          merchantId: m.id,
          cutoffAt: endOfDay(body.cutoffDay),
          actorUserId: user.sub,
        });
        created.push({ merchantId: m.id, amountPiastres: p.amountPiastres });
      } catch (error) {
        if (error instanceof DomainError) skipped.push({ merchantId: m.id, reason: error.code });
        else throw error;
      }
    }
    return { created, skipped };
  }

  @Post('payouts/:id/paid')
  paid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutPaidSchema)) body: z.infer<typeof payoutPaidSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return markPayoutPaid(this.prisma, {
      payoutId: id,
      reference: body.reference,
      bankAccountId: body.bankAccountId,
      actorUserId: user.sub,
    });
  }

  @Post('payouts/:id/cancel')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutCancelSchema)) body: { note: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return cancelPayout(this.prisma, { payoutId: id, note: body.note, actorUserId: user.sub });
  }

  @Post('receipts')
  async receipt(
    @Body(new ZodValidationPipe(merchantReceiptSchema)) body: z.infer<typeof merchantReceiptSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const entry = await recordMerchantReceipt(this.prisma, { ...body, actorUserId: user.sub });
    return { id: entry.id };
  }

  @Post('adjustments')
  async adjustment(
    @Body(new ZodValidationPipe(merchantAdjustmentSchema))
    body: z.infer<typeof merchantAdjustmentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const entry = await recordMerchantAdjustment(this.prisma, { ...body, actorUserId: user.sub });
    return { id: entry.id };
  }

  @Post('rider-bonus-payouts')
  async bonusPayout(
    @Body(new ZodValidationPipe(riderBonusPayoutSchema))
    body: z.infer<typeof riderBonusPayoutSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const entry = await payRiderBonus(this.prisma, { ...body, actorUserId: user.sub });
    return { id: entry.id };
  }

  @Patch('merchants/:id/payout-schedule')
  async schedule(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutScheduleSchema)) body: z.infer<typeof payoutScheduleSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.merchant.findUnique({ where: { id } });
      if (!before) throw new DomainError('merchant_not_found', 404);
      await tx.merchant.update({ where: { id }, data: { payoutSchedule: body.payoutSchedule } });
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'finance.payout_schedule',
        entityType: 'merchant',
        entityId: id,
        before: { payoutSchedule: before.payoutSchedule },
        after: { payoutSchedule: body.payoutSchedule },
      });
      return { payoutSchedule: body.payoutSchedule };
    });
  }

  @Get('statements/:merchantId')
  @ApiQuery({ name: 'from', required: false, description: 'Cairo day, default 30 days ago' })
  @ApiQuery({ name: 'to', required: false, description: 'Cairo day, included, default today' })
  statement(
    @Param('merchantId') merchantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = parseRange(from, to, this.clock.now(), 30);
    return merchantStatement(this.prisma, merchantId, range.from, range.to);
  }

  @Get('statements/:merchantId/export.csv')
  async statementCsv(
    @Res() res: Response,
    @Param('merchantId') merchantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = parseRange(from, to, this.clock.now(), 30);
    const s = await merchantStatement(this.prisma, merchantId, range.from, range.to);
    const body = csv(
      ['date_cairo', 'type', 'order', 'reference', 'amount_egp', 'balance_egp'],
      [
        [cairoStamp(range.from), 'opening_balance', null, null, null, egp(s.openingOwedPiastres)],
        ...s.lines.map((l) => [
          cairoStamp(l.at),
          l.kind,
          l.orderNumber,
          l.orderNumber ? null : l.memo,
          egp(l.amountPiastres),
          egp(l.balanceAfterPiastres),
        ]),
        [
          cairoStamp(new Date(range.to.getTime() - 1)),
          'closing_balance',
          null,
          null,
          null,
          egp(s.closingOwedPiastres),
        ],
      ],
    );
    const name = `statement-${s.merchant.name.replace(/[^A-Za-z0-9]+/g, '-')}-${cairoDay(range.from)}.csv`;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.send(body);
  }

  @Get('merchants/:merchantId/owed')
  async owed(@Param('merchantId') merchantId: string) {
    return { owedPiastres: await merchantOwed(this.prisma, merchantId) };
  }

  @Get('ledger')
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'accountKey', required: false })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'number', required: false, description: 'Voucher, JV-000123 or 123' })
  @ApiQuery({ name: 'accountId', required: false })
  ledger(
    @Query('number') number?: string,
    @Query('accountId') accountId?: string,
    @Query('kind') kind?: string,
    @Query('accountKey') accountKey?: string,
    @Query('orderId') orderId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    const voucher = number ? Number(/(\d+)\s*$/.exec(number)?.[1] ?? NaN) : undefined;
    if (voucher !== undefined && !Number.isSafeInteger(voucher))
      throw new DomainError('invalid_number', 400);
    return listLedgerEntries(this.prisma, {
      number: voucher,
      accountId: accountId || undefined,
      kind: kind || undefined,
      accountKey: accountKey || undefined,
      orderId: orderId || undefined,
      from: parseBound(from, 'from'),
      to: parseBound(to, 'to'),
      cursor: cursor || undefined,
    });
  }

  /** The journal for the accountant: one row per line, debits and credits in EGP. */
  @Get('ledger/export.csv')
  async ledgerCsv(@Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to, this.clock.now(), 30);
    const rows: (string | number | null)[][] = [];
    let cursor: string | undefined;
    do {
      const page = await listLedgerEntries(this.prisma, { ...range, cursor, take: 200 });
      for (const e of page.rows)
        for (const l of e.lines)
          rows.push([
            cairoStamp(e.at),
            e.number,
            e.kind,
            e.orderNumber,
            e.memo,
            l.accountCode,
            l.accountName ?? l.owner,
            l.amountPiastres > 0 ? egp(l.amountPiastres) : null,
            l.amountPiastres < 0 ? egp(0 - l.amountPiastres) : null,
            e.by,
          ]);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="shiply-journal-${cairoDay(range.from)}.csv"`,
    );
    res.send(
      csv(
        [
          'date_cairo',
          'entry',
          'type',
          'order',
          'memo',
          'account_code',
          'account',
          'debit_egp',
          'credit_egp',
          'by',
        ],
        rows,
      ),
    );
  }
}
