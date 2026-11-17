import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  claimCategories,
  DomainError,
  expenseClaimDetail,
  managerDecideClaim,
  moneyAccounts,
  payExpenseClaim,
  rejectExpenseClaim,
  setClaimableCategory,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  bulkIdsSchema,
  claimableCategorySchema,
  claimPaySchema,
  claimRejectSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { eachRecord } from '../common/bulk';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Employee expense claims for Accounting: view reads (the list is /finance/lists/expense_claims,
 * the page /finance/documents/expense_claim/<id>); use pays an approved claim from a bank or
 * cash box or refuses it with a reason. A claim of a store is kept inside the reader's stores;
 * company wide claims are open to every accounting reader (as finance requests are). Nobody
 * pays or refuses their own claim, and from finance.approval_threshold_piastres not the manager
 * who approved it.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance')
export class ExpenseClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private async inScope(id: string, access: AccessProfile) {
    const c = await this.prisma.expenseClaim.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (!c) throw new DomainError('expense_claim_not_found', 404);
    if (c.darkStoreId) assertStore(access, c.darkStoreId);
  }

  /** Expense categories and whether employees may claim each. */
  @Get('expense-claims/categories')
  categories() {
    return claimCategories(this.prisma);
  }

  @Post('expense-claims/categories/:accountId')
  @Access('accounting', 'manage')
  category(
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(claimableCategorySchema))
    body: z.infer<typeof claimableCategorySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setClaimableCategory(this.prisma, {
      accountId,
      claimable: body.claimable,
      actorUserId: user.sub,
    });
  }

  /** One claim with the banks and cash boxes it may be paid from (balances shown). */
  @Get('expense-claims/:id')
  async claim(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    await this.inScope(id, access);
    const [claim, money] = await Promise.all([
      expenseClaimDetail(this.prisma, { claimId: id, viewerUserId: '', scope: 'accounting' }),
      moneyAccounts(this.prisma),
    ]);
    return {
      claim,
      moneyAccounts: money.map((a) => ({
        id: a.id,
        code: a.code,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        balancePiastres: a.balancePiastres,
      })),
    };
  }

  @Post('expense-claims/:id/pay')
  async pay(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimPaySchema)) body: z.infer<typeof claimPaySchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.inScope(id, access);
    return payExpenseClaim(this.prisma, {
      claimId: id,
      moneyAccountId: body.moneyAccountId,
      reference: body.reference,
      actorUserId: user.sub,
      now: this.clock.now(),
    });
  }

  @Post('expense-claims/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimRejectSchema)) body: z.infer<typeof claimRejectSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.inScope(id, access);
    return rejectExpenseClaim(this.prisma, {
      claimId: id,
      actorUserId: user.sub,
      reason: body.reason,
      now: this.clock.now(),
    });
  }

  /**
   * Approves several claims at the manager step, each on its own: only claims of people whose
   * manager in force is the reader (others answer not_your_team), never their own.
   */
  @Post('expense-claims/bulk-approve')
  bulkApprove(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      await this.inScope(id, access);
      await managerDecideClaim(this.prisma, {
        claimId: id,
        actorUserId: user.sub,
        approve: true,
        now: this.clock.now(),
      });
    });
  }
}
