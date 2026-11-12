import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  cancelExpenseClaim,
  DomainError,
  expenseClaimDetail,
  managerDecideClaim,
  myExpenseClaims,
  myPayslip,
  myPayslips,
  submitExpenseClaim,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  claimRejectSchema,
  entryNumber,
  type ExpenseClaimBody,
  expenseClaimSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * My HR, pay: a person's own payslips (only once the month's salary run is posted) and their
 * expense claims; managers approve or refuse their direct reports' claims at the first step.
 * Open to any signed in user (listed in test/route-access.test.ts): the person always comes
 * from the session, never from the address; merchants have no file (404).
 */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('me')
export class MyPayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async file(userId: string) {
    const e = await this.prisma.employee.findUnique({
      where: { userId },
      select: { id: true, payBasis: true },
    });
    if (!e) throw new DomainError('employee_not_found', 404);
    return e;
  }

  // ─── payslips ─────────────────────────────────────────────────────────────────

  /** My payslips by month; riders paid per delivery have none (their wallet instead). */
  @Get('payslips')
  async payslips(@CurrentUser() user: AccessTokenClaims) {
    const e = await this.file(user.sub);
    const slips = e.payBasis === 'per_delivery' ? [] : await myPayslips(this.prisma, user.sub);
    return {
      payBasis: e.payBasis,
      payslips: slips.map((s) => ({
        month: s.month,
        entryNumber: entryNumber(s.entryNumber),
        paidAt: s.paidAt,
        gross: s.gross,
        net: s.net,
      })),
    };
  }

  /** One of my payslips (YYYY-MM): 404 when it is not posted or not mine. */
  @Get('payslips/:month')
  async payslip(@Param('month') month: string, @CurrentUser() user: AccessTokenClaims) {
    const e = await this.file(user.sub);
    if (e.payBasis === 'per_delivery') throw new DomainError('payslip_not_found', 404);
    const [slip, me] = await Promise.all([
      myPayslip(this.prisma, user.sub, month),
      this.prisma.employee.findUnique({
        where: { userId: user.sub },
        select: {
          number: true,
          nameEn: true,
          nameAr: true,
          nationalId: true,
          socialInsuranceNumber: true,
          department: { select: { nameEn: true, nameAr: true } },
          position: { select: { titleEn: true, titleAr: true } },
          homeStore: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
    ]);
    return { ...slip, entryNumber: entryNumber(slip.entryNumber), employee: me };
  }

  // ─── expense claims ───────────────────────────────────────────────────────────

  /** My claims, newest first, with the categories, stores and day range the form offers. */
  @Get('expense-claims')
  claims(@CurrentUser() user: AccessTokenClaims) {
    return myExpenseClaims(this.prisma, user.sub, this.clock.now());
  }

  @Post('expense-claims')
  submit(
    @Body(new ZodValidationPipe(expenseClaimSchema)) body: ExpenseClaimBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return submitExpenseClaim(this.prisma, { userId: user.sub, body, now: this.clock.now() });
  }

  @Get('expense-claims/:id')
  claim(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return expenseClaimDetail(this.prisma, { claimId: id, viewerUserId: user.sub, scope: 'self' });
  }

  @Post('expense-claims/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return cancelExpenseClaim(this.prisma, {
      claimId: id,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  /** A team member's claim, read only for their manager (in force or who decided it). */
  @Get('team-expense-claims/:id')
  teamClaim(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return expenseClaimDetail(this.prisma, {
      claimId: id,
      viewerUserId: user.sub,
      scope: 'manager',
    });
  }

  @Post('inbox/expense-claims/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return managerDecideClaim(this.prisma, {
      claimId: id,
      actorUserId: user.sub,
      approve: true,
      now: this.clock.now(),
    });
  }

  @Post('inbox/expense-claims/:id/reject')
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimRejectSchema)) body: z.infer<typeof claimRejectSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return managerDecideClaim(this.prisma, {
      claimId: id,
      actorUserId: user.sub,
      approve: false,
      reason: body.reason,
      now: this.clock.now(),
    });
  }
}
