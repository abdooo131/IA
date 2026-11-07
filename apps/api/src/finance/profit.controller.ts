import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  costPerOrder,
  DomainError,
  listStaffPay,
  outsourcedCommissionsToPay,
  payslips,
  previewPayroll,
  submitStaffBonus,
  profitBy,
  submitAdvance,
  submitPayroll,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  advanceSchema,
  entryNumber,
  payrollSchema,
  staffBonusSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';

const DIMENSIONS = ['store', 'merchant', 'rider'] as const;

/** Profit per store, merchant and rider; cost per order; salaries and staff advances. */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class ProfitController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('profit')
  @ApiQuery({ name: 'by', required: false, enum: DIMENSIONS })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  profit(@Query('by') by?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const dimension = DIMENSIONS.find((d) => d === by) ?? 'store';
    const range = parseRange(from, to, this.clock.now(), 30);
    return profitBy(this.prisma, { ...range, by: dimension });
  }

  @Get('cost-per-order')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  costs(@Query('from') from?: string, @Query('to') to?: string) {
    return costPerOrder(this.prisma, parseRange(from, to, this.clock.now(), 30));
  }

  /** Dark stores and hubs, for tagging a cost to the place it belongs to. */
  @Get('stores')
  stores() {
    return this.prisma.darkStore.findMany({
      where: { isActive: true },
      select: { id: true, code: true, nameEn: true, nameAr: true, kind: true },
      orderBy: { code: 'asc' },
    });
  }

  @Get('staff-pay')
  @Access('accounting', 'view', { salaries: true })
  staff() {
    return listStaffPay(this.prisma);
  }

  /**
   * Sales commission approved by the sales manager for people hired through an outsourcing
   * company, waiting to be paid as a direct bonus (employees get theirs in the salary run).
   */
  @Get('staff-commissions')
  @Access('accounting', 'view', { salaries: true })
  commissions() {
    return outsourcedCommissionsToPay(this.prisma);
  }

  /** A bonus paid straight to an outsourced person. */
  @Post('staff-bonuses')
  @Access('accounting', 'use', { salaries: true })
  async bonus(
    @Body(new ZodValidationPipe(staffBonusSchema)) body: z.infer<typeof staffBonusSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitStaffBonus(this.prisma, { ...body, actorUserId: user.sub }));
  }

  /** The payslips of a month's salary run. */
  @Get('payslips')
  @Access('accounting', 'view', { salaries: true })
  @ApiQuery({ name: 'month', required: true })
  async payslips(@Query('month') month: string) {
    const run = await payslips(this.prisma, month ?? '');
    return {
      ...run,
      entryNumber: run.entryNumber ? entryNumber(run.entryNumber) : null,
    };
  }

  @Post('advances')
  @Access('accounting', 'use', { salaries: true })
  async advance(
    @Body(new ZodValidationPipe(advanceSchema)) body: z.infer<typeof advanceSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitAdvance(this.prisma, { ...body, actorUserId: user.sub }));
  }

  /** What the month's run would pay, checked, without paying. */
  @Post('payroll/preview')
  @Access('accounting', 'use', { salaries: true })
  preview(@Body(new ZodValidationPipe(payrollSchema)) body: z.infer<typeof payrollSchema>) {
    return previewPayroll(this.prisma, body);
  }

  @Post('payroll')
  @Access('accounting', 'use', { salaries: true })
  async payroll(
    @Body(new ZodValidationPipe(payrollSchema)) body: z.infer<typeof payrollSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (!body.lines.length) throw new DomainError('nothing_to_pay', 400);
    return submitted(await submitPayroll(this.prisma, { ...body, actorUserId: user.sub }));
  }
}
