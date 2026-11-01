import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  costPerOrder,
  DomainError,
  listStaffPay,
  payslips,
  previewPayroll,
  setEmployment,
  submitStaffBonus,
  profitBy,
  setSalary,
  submitAdvance,
  submitPayroll,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  advanceSchema,
  employmentSchema,
  entryNumber,
  payrollSchema,
  salarySchema,
  staffBonusSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { submitted } from './books.controller';

const DIMENSIONS = ['store', 'merchant', 'rider'] as const;

/** Profit per store, merchant and rider; cost per order; salaries and staff advances. */
@ApiTags('finance')
@ApiBearerAuth()
@Roles('admin', 'finance')
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
  staff() {
    return listStaffPay(this.prisma);
  }

  /** A team member's monthly salary: admin only. */
  @Put('salaries/:userId')
  @Roles('admin')
  salary(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(salarySchema)) body: z.infer<typeof salarySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setSalary(this.prisma, {
      userId,
      monthlyPiastres: body.monthlyPiastres,
      insuredWagePiastres: body.insuredWagePiastres,
      actorUserId: user.sub,
    });
  }

  /** Employee on our payroll, or hired through an outsourcing company: admin only. */
  @Put('employment/:userId')
  @Roles('admin')
  employment(
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(employmentSchema)) body: z.infer<typeof employmentSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setEmployment(this.prisma, { ...body, userId, actorUserId: user.sub });
  }

  /** A bonus paid straight to an outsourced person. */
  @Post('staff-bonuses')
  async bonus(
    @Body(new ZodValidationPipe(staffBonusSchema)) body: z.infer<typeof staffBonusSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitStaffBonus(this.prisma, { ...body, actorUserId: user.sub }));
  }

  /** The payslips of a month's salary run. */
  @Get('payslips')
  @ApiQuery({ name: 'month', required: true })
  async payslips(@Query('month') month: string) {
    const run = await payslips(this.prisma, month ?? '');
    return {
      ...run,
      entryNumber: run.entryNumber ? entryNumber(run.entryNumber) : null,
    };
  }

  @Post('advances')
  async advance(
    @Body(new ZodValidationPipe(advanceSchema)) body: z.infer<typeof advanceSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitted(await submitAdvance(this.prisma, { ...body, actorUserId: user.sub }));
  }

  /** What the month's run would pay, checked, without paying. */
  @Post('payroll/preview')
  preview(@Body(new ZodValidationPipe(payrollSchema)) body: z.infer<typeof payrollSchema>) {
    return previewPayroll(this.prisma, body);
  }

  @Post('payroll')
  async payroll(
    @Body(new ZodValidationPipe(payrollSchema)) body: z.infer<typeof payrollSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (!body.lines.length) throw new DomainError('nothing_to_pay', 400);
    return submitted(await submitPayroll(this.prisma, { ...body, actorUserId: user.sub }));
  }
}
