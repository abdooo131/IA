import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { budgetYear, copyBudgetYear, DomainError, setQuarterBudget } from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  budgetCopySchema,
  budgetQuarterSchema,
  cairoDay,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { assertStore } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { Clock } from '../common/clock';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** 'all' and 'company' cover every store, so people limited to some stores need a store. */
function checkScope(access: AccessProfile | undefined, scope: string) {
  assertStore(access, scope === 'all' || scope === 'company' ? null : scope);
}

/**
 * Budgets planned per quarter, then by month (the month routes stay on PeriodController:
 * GET and PUT /finance/budgets). Reading needs accounting view, changing accounting use.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Access('accounting')
@Controller('finance/budgets')
export class BudgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('year')
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'scope', required: false, description: "'all', 'company' or a store id" })
  @ApiQuery({ name: 'group', required: false, description: 'An account group, e.g. 5400' })
  year(
    @Query('year') year?: string,
    @Query('scope') scope?: string,
    @Query('group') group?: string,
    @CurrentAccess() access?: AccessProfile,
  ) {
    const y = year ? Number(year) : Number(cairoDay(this.clock.now()).slice(0, 4));
    if (!Number.isInteger(y)) throw new DomainError('invalid_year', 400);
    const s = scope || 'all';
    checkScope(access, s);
    const g = group ? Number(group) : undefined;
    if (g !== undefined && !Number.isInteger(g)) throw new DomainError('invalid_group', 400);
    return budgetYear(this.prisma, { year: y, scope: s, groupCode: g });
  }

  /** Sets a quarter: its three months get the equal split (the last takes the rounding). */
  @Put('quarter')
  setQuarter(
    @Body(new ZodValidationPipe(budgetQuarterSchema)) body: z.infer<typeof budgetQuarterSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access?: AccessProfile,
  ) {
    assertStore(access, body.darkStoreId ?? null);
    return setQuarterBudget(this.prisma, { ...body, actorUserId: user.sub });
  }

  /** Copies one year's budget to another, optionally raised or lowered by a percent. */
  @Post('copy')
  copy(
    @Body(new ZodValidationPipe(budgetCopySchema)) body: z.infer<typeof budgetCopySchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access?: AccessProfile,
  ) {
    checkScope(access, body.scope);
    return copyBudgetYear(this.prisma, { ...body, actorUserId: user.sub });
  }
}
