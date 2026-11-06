import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listCashHandovers, recordCashHandover, riderCash, storeRiderCash } from '@shiplynow/db';
import { type AccessTokenClaims, cashHandoverSchema } from '@shiplynow/shared';
import type { z } from 'zod';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

/** Riders hand the cash they collected to the store at the end of a shift. */
@ApiTags('store')
@ApiBearerAuth()
@Access('store')
@Controller('stores/:storeId/cash')
export class StoreCashController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  /**
   * The store's riders with the cash each one is carrying (since when, and whether it is past
   * finance.rider_cash_max_hours), the store's cash limit, and recent handovers.
   */
  @Get()
  async overview(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const held = await storeRiderCash(this.prisma, storeId);
    const riders = await this.prisma.rider.findMany({
      where: { darkStoreId: storeId, user: { isActive: true } },
      include: { user: { select: { name: true } } },
      orderBy: { badgeCode: 'asc' },
    });
    return {
      maxHours: held.maxHours,
      limitPiastres: held.limitPiastres,
      riders: await Promise.all(
        riders.map(async (r) => {
          const h = held.riders.find((x) => x.riderId === r.id);
          return {
            id: r.id,
            name: r.user.name,
            badgeCode: r.badgeCode,
            cashPiastres: await riderCash(this.prisma, r.id),
            heldSince: h?.heldSince ?? null,
            overdue: h?.overdue ?? false,
            outNow: await this.prisma.delivery.count({
              where: { riderId: r.id, status: { in: ['assigned', 'picked_up'] } },
            }),
          };
        }),
      ),
      recent: await listCashHandovers(this.prisma, { darkStoreId: storeId, take: 20 }),
    };
  }

  @Post('handovers')
  async handover(
    @Param('storeId') storeId: string,
    @Body(new ZodValidationPipe(cashHandoverSchema)) body: z.infer<typeof cashHandoverSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const h = await recordCashHandover(this.prisma, {
      ...body,
      darkStoreId: storeId,
      receivedById: user.sub,
    });
    return {
      id: h.id,
      status: h.status,
      expectedPiastres: h.expectedPiastres,
      countedPiastres: h.countedPiastres,
      differencePiastres: h.differencePiastres,
    };
  }
}
