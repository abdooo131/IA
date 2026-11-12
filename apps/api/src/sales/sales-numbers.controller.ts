import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  adjustCommission,
  approveCommission,
  crmActor,
  listCommissions,
  listTargets,
  salesDashboard,
  setTarget,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  cairoDay,
  type CommissionAdjustBody,
  commissionAdjustSchema,
  type TargetBody,
  targetSchema,
} from '@shiplynow/shared';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const thisMonth = () => cairoDay(new Date()).slice(0, 7);

/**
 * Sales CRM part 2 (docs/SALES.md 9 to 11): the dashboard, targets and commission. Reps see
 * their own numbers; sales managers see everyone, set targets and approve commission (never
 * their own: same_person).
 */
@ApiTags('sales')
@ApiBearerAuth()
@Access('sales')
@Controller('sales')
export class SalesNumbersController {
  constructor(private readonly prisma: PrismaService) {}

  private actor(access: AccessProfile, user: AccessTokenClaims) {
    return crmActor(access, user.sub);
  }

  @Get('dashboard')
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (Cairo), default this month' })
  @ApiQuery({ name: 'ownerId', required: false })
  dashboard(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('month') month?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return salesDashboard(this.prisma, this.actor(access, user), {
      month: month || thisMonth(),
      ownerId: ownerId || null,
    });
  }

  @Get('targets')
  @ApiQuery({ name: 'month', required: false })
  targets(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('month') month?: string,
  ) {
    return listTargets(this.prisma, this.actor(access, user), month || thisMonth());
  }

  @Post('targets')
  @Access('sales', 'manage')
  setTarget(
    @Body(new ZodValidationPipe(targetSchema)) body: TargetBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return setTarget(this.prisma, body, this.actor(access, user));
  }

  @Get('commissions')
  @ApiQuery({ name: 'userId', required: false, description: 'sales managers: one rep' })
  commissions(
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
    @Query('userId') userId?: string,
  ) {
    return listCommissions(this.prisma, this.actor(access, user), { userId: userId || null });
  }

  @Post('commissions/:id/adjust')
  @Access('sales', 'manage')
  adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(commissionAdjustSchema)) body: CommissionAdjustBody,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return adjustCommission(this.prisma, id, body, this.actor(access, user));
  }

  @Post('commissions/:id/approve')
  @Access('sales', 'manage')
  approve(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return approveCommission(this.prisma, id, this.actor(access, user));
  }
}
