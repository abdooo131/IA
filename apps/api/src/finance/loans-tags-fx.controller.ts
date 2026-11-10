import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  costTagReport,
  createCostTag,
  DomainError,
  foreignBanks,
  listCostTags,
  listLoans,
  loanDetail,
  revalueForeignBank,
  submitLoan,
  submitLoanPayment,
  updateCostTag,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  addDays,
  cairoDay,
  COMPARE_MODES,
  type CompareMode,
  costTagSchema,
  fxRevalueSchema,
  isCalendarDay,
  loanPaymentSchema,
  loanSchema,
  updateCostTagSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';

/**
 * Loans the company borrowed (LN-), the user's own cost tags and their report, and bank
 * accounts in another currency (balances and the month end revaluation).
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class LoansTagsFxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  // ─── loans ───

  @Get('loans')
  loans() {
    return listLoans(this.prisma, this.clock.now());
  }

  @Get('loans/:id')
  loan(@Param('id') id: string) {
    return loanDetail(this.prisma, id);
  }

  /** A loan received: money in, so it waits for a second person (finance.approve_money_in). */
  @Post('loans')
  async create(
    @Body(new ZodValidationPipe(loanSchema)) body: z.infer<typeof loanSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitLoan(this.prisma, { ...body, actorUserId: user.sub }));
  }

  /** Pays the loan's next instalment: at once below the approval limit, else waiting. */
  @Post('loans/:id/pay')
  async pay(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(loanPaymentSchema)) body: z.infer<typeof loanPaymentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(
      await submitLoanPayment(this.prisma, { ...body, loanId: id, actorUserId: user.sub }),
    );
  }

  // ─── cost tags ───

  @Get('cost-tags')
  @ApiQuery({ name: 'active', required: false, description: 'true: only tags that can be chosen' })
  tags(@Query('active') active?: string) {
    return listCostTags(this.prisma, { activeOnly: active === 'true' });
  }

  @Post('cost-tags')
  @Access('accounting', 'manage')
  async createTag(
    @Body(new ZodValidationPipe(costTagSchema)) body: z.infer<typeof costTagSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const tag = await createCostTag(this.prisma, { ...body, actorUserId: user.sub });
    return { id: tag.id };
  }

  @Patch('cost-tags/:id')
  @Access('accounting', 'manage')
  async updateTag(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCostTagSchema)) body: z.infer<typeof updateCostTagSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const tag = await updateCostTag(this.prisma, {
      ...body,
      costTagId: id,
      actorUserId: user.sub,
    });
    return { id: tag.id, isActive: tag.isActive };
  }

  /** Costs and income by tag over a period (default this month), with a comparison. */
  @Get('cost-tags/report')
  @ApiQuery({ name: 'from', required: false, description: 'Cairo day, default the 1st' })
  @ApiQuery({ name: 'to', required: false, description: 'Cairo day, default today' })
  @ApiQuery({ name: 'compare', required: false, enum: COMPARE_MODES })
  tagReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compare') compare?: string,
  ) {
    const today = cairoDay(this.clock.now());
    const start = from && isCalendarDay(from) ? from : `${today.slice(0, 8)}01`;
    const end = to && isCalendarDay(to) ? to : today;
    if (addDays(start, 400) < end) throw new DomainError('range_too_long', 400);
    const mode = COMPARE_MODES.includes(compare as CompareMode) ? (compare as CompareMode) : 'none';
    return costTagReport(this.prisma, { from: start, to: end, compare: mode });
  }

  // ─── bank accounts in another currency ───

  @Get('foreign-banks')
  foreign() {
    return foreignBanks(this.prisma, this.clock.now());
  }

  /** Month end: brings the account's EGP balance to its foreign balance × the rate entered. */
  @Post('accounts/:id/revalue')
  @Access('accounting', 'manage')
  revalue(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(fxRevalueSchema)) body: z.infer<typeof fxRevalueSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return revalueForeignBank(this.prisma, {
      ...body,
      accountId: id,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }
}
