import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  listCashHandovers,
  listRiderWithdrawals,
  payWithdrawal,
  recordCashHandover,
  cashToHandIn,
  getSetting,
  storeRiderCash,
} from '@shiplynow/db';
import { type AccessTokenClaims, cashHandoverSchema, withdrawalPaySchema } from '@shiplynow/shared';
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
    const handoverOpen = await getSetting(this.prisma, 'cash.store_handover_enabled', storeId);
    return {
      maxHours: held.maxHours,
      limitPiastres: held.limitPiastres,
      // The store channel may be closed (cash.store_handover_enabled): Basata stays open.
      handoverEnabled: handoverOpen === 1,
      riders: await Promise.all(
        riders.map(async (r) => {
          const h = held.riders.find((x) => x.riderId === r.id);
          return {
            id: r.id,
            name: r.user.name,
            badgeCode: r.badgeCode,
            cashPiastres: await cashToHandIn(this.prisma, r.id),
            heldSince: h?.heldSince ?? null,
            overdue: h?.overdue ?? false,
            frozen: Boolean(r.frozenAt),
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

  /**
   * Rider pay: withdrawals Accounting approved to be paid in cash at this store. The store
   * manager (store manage) hands the cash over and records it, from the store's cash box.
   */
  @Get('withdrawals')
  @Access('store', 'manage')
  async withdrawals(@Param('storeId') storeId: string, @CurrentUser() user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const all = await listRiderWithdrawals(this.prisma, {
      darkStoreId: storeId,
      method: 'store_cash',
    });
    return all.withdrawals
      .filter((w) => w.status === 'approved' || w.status === 'paid')
      .slice(0, 30);
  }

  @Post('withdrawals/:id/pay')
  @Access('store', 'manage')
  async payWithdrawal(
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(withdrawalPaySchema)) body: z.infer<typeof withdrawalPaySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return payWithdrawal(this.prisma, {
      withdrawalId: id,
      reference: body.reference,
      actorUserId: user.sub,
      storeId,
    });
  }
}
