import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { planRefill, refillOverview, setStockTarget } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cairoDay,
  type StockTargetBody,
  stockTargetSchema,
  type AccessProfile,
} from '@shiplynow/shared';
import { assertStore } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Automatic refill: the levels per store and product, and preparing today's drafts now. */
@ApiTags('admin')
@ApiBearerAuth()
@Access('inventory')
@Controller('admin/refill')
export class AdminRefillController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  overview() {
    return refillOverview(this.prisma);
  }

  @Put('targets')
  setTarget(
    @Body(new ZodValidationPipe(stockTargetSchema)) body: StockTargetBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    assertStore(access, body.darkStoreId);
    return setStockTarget(this.prisma, { ...body, actorUserId: user.sub });
  }

  /** Prepares today's drafts without waiting for the evening run. Once per day, like the job. */
  @Post('run')
  run(@CurrentUser() user: AccessTokenClaims) {
    return planRefill(this.prisma, { day: cairoDay(new Date()), actorUserId: user.sub });
  }
}
