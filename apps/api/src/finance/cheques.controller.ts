import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  bounceCheque,
  cancelCheque,
  chequesDue,
  clearCheque,
  depositCheque,
  DomainError,
  getCheque,
  getContract,
  listCheques,
  listContracts,
  merchantProfitability,
  merchantProfitDetail,
  movementTarget,
  registerCheque,
  submitDeposit,
  withAttachments,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  CHEQUE_DIRECTIONS,
  CHEQUE_STATUSES,
  type ChequeBody,
  chequeBounceSchema,
  chequeCancelSchema,
  chequeClearSchema,
  chequeDepositSchema,
  chequeSchema,
  type DepositBody,
  depositSchema,
  entryNumber,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Cheques register, merchant contracts as Accounting sees them (with security deposits) and
 * merchant profitability with its what if base. Booking a cheque or a deposit follows the
 * second person rule.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class ChequesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ─── cheques ─────────────────────────────────────────────────────────────────

  @Get('cheques')
  @ApiQuery({ name: 'status', required: false, enum: CHEQUE_STATUSES })
  @ApiQuery({ name: 'direction', required: false, enum: CHEQUE_DIRECTIONS })
  cheques(@Query('status') status?: string, @Query('direction') direction?: string) {
    return listCheques(this.prisma, {
      status: CHEQUE_STATUSES.find((s) => s === status),
      direction: CHEQUE_DIRECTIONS.find((d) => d === direction),
    });
  }

  /** Cheques still waiting for their money: overdue and due within seven days. */
  @Get('cheques-due')
  due() {
    return chequesDue(this.prisma, cairoDay(this.clock.now()));
  }

  @Get('cheques/:id')
  async cheque(@Param('id') id: string) {
    const c = await getCheque(this.prisma, id);
    const voucher = (e: { id: string; number: number } | null) =>
      e ? { id: e.id, number: entryNumber(e.number) } : null;
    return {
      ...c,
      bookEntry: voucher(c.bookEntry),
      clearEntry: voucher(c.clearEntry),
      reverseEntry: voucher(c.reverseEntry),
    };
  }

  @Post('cheques')
  async register(
    @Body(new ZodValidationPipe(chequeSchema)) body: ChequeBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { attachmentIds, ...rest } = body;
    // Files go to the booking entry, or to its request while it waits for a second person.
    const result = await withAttachments(
      this.prisma,
      { ids: attachmentIds, actorUserId: user.sub },
      (db) => registerCheque(db, { ...rest, actorUserId: user.sub }),
      // A payout cheque waits for the payout checks: its files go to the payout.
      (r) =>
        r.status === 'awaiting_checks' && r.cheque.payoutId
          ? { payoutId: r.cheque.payoutId }
          : movementTarget(r),
    );
    return {
      id: result.cheque.id,
      status: result.status,
      chequeStatus: result.cheque.status,
      amountPiastres: result.cheque.amountPiastres,
      ...(result.request ? { requestId: result.request.id } : {}),
    };
  }

  @Post('cheques/:id/deposit')
  deposit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chequeDepositSchema)) body: z.infer<typeof chequeDepositSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return depositCheque(this.prisma, { ...body, chequeId: id, actorUserId: user.sub });
  }

  @Post('cheques/:id/clear')
  async clear(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chequeClearSchema)) body: z.infer<typeof chequeClearSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const result = await clearCheque(this.prisma, { ...body, chequeId: id, actorUserId: user.sub });
    return { status: result.status, number: entryNumber(result.number) };
  }

  @Post('cheques/:id/bounce')
  bounce(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chequeBounceSchema)) body: z.infer<typeof chequeBounceSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return bounceCheque(this.prisma, { ...body, chequeId: id, actorUserId: user.sub });
  }

  @Post('cheques/:id/cancel')
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chequeCancelSchema)) body: z.infer<typeof chequeCancelSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return cancelCheque(this.prisma, { note: body.note, chequeId: id, actorUserId: user.sub });
  }

  // ─── contracts and deposits ──────────────────────────────────────────────────

  /** Every merchant contract with the deposit held and what the merchant owes. */
  @Get('contracts')
  contracts() {
    return listContracts(this.prisma, this.clock.now());
  }

  @Get('contracts/:merchantId')
  contract(@Param('merchantId') merchantId: string) {
    return getContract(this.prisma, merchantId, this.clock.now());
  }

  /** A security deposit received or paid back (second person rule). */
  @Post('merchants/:merchantId/deposit')
  async securityDeposit(
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(depositSchema)) body: DepositBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { attachmentIds, ...rest } = body;
    return submitted(
      await withAttachments(this.prisma, { ids: attachmentIds, actorUserId: user.sub }, (db) =>
        submitDeposit(db, { ...rest, merchantId, actorUserId: user.sub }),
      ),
    );
  }

  // ─── merchant profitability ──────────────────────────────────────────────────

  private month(month?: string) {
    if (month && !MONTH.test(month)) throw new DomainError('invalid_month', 400);
    return month || cairoDay(this.clock.now()).slice(0, 7);
  }

  @Get('merchant-profit')
  @ApiQuery({ name: 'month', required: false })
  profitability(@Query('month') month?: string) {
    return merchantProfitability(this.prisma, { month: this.month(month) });
  }

  @Get('merchant-profit/:merchantId')
  @ApiQuery({ name: 'month', required: false })
  profitDetail(@Param('merchantId') merchantId: string, @Query('month') month?: string) {
    return merchantProfitDetail(this.prisma, { month: this.month(month), merchantId });
  }
}
