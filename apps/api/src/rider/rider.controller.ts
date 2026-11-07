import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  cancelWithdrawal,
  completeDelivery,
  failDelivery,
  getSetting,
  recordDeliveryCall,
  recordRiderLocation,
  requestWithdrawal,
  riderCash,
  riderWallet,
  riderWalletTotals,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  completeDeliverySchema,
  failDeliverySchema,
  riderLocationSchema,
  withdrawalRequestSchema,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** The rider app: only the signed in rider's own deliveries. */
@ApiTags('rider')
@ApiBearerAuth()
@Roles('rider')
@Controller('rider')
export class RiderController {
  constructor(private readonly prisma: PrismaService) {}

  private async riderOf(user: AccessTokenClaims) {
    const rider = await this.prisma.rider.findUnique({
      where: { userId: user.sub },
      include: { darkStore: true, user: true },
    });
    if (!rider) throw new ForbiddenException({ error: 'no_rider_profile' });
    return rider;
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenClaims) {
    const rider = await this.riderOf(user);
    const since = new Date(Date.now() - 24 * 3600_000);
    const today = await this.prisma.delivery.findMany({
      where: {
        riderId: rider.id,
        OR: [{ deliveredAt: { gte: since } }, { failedAt: { gte: since } }],
      },
    });
    const [cash, wallet, pingSeconds] = await Promise.all([
      riderCash(this.prisma, rider.id),
      riderWalletTotals(this.prisma, rider.id),
      getSetting(this.prisma, 'tracking.rider_ping_seconds', rider.darkStoreId),
    ]);
    return {
      name: rider.user.name,
      pingSeconds,
      badgeCode: rider.badgeCode,
      wallet: {
        cashPiastres: cash,
        availablePiastres: wallet.totals.availablePiastres,
        onHoldPiastres: wallet.totals.onHoldPiastres,
        earnedMonthPiastres: wallet.totals.earnedMonthPiastres,
      },
      darkStore: {
        code: rider.darkStore.code,
        nameEn: rider.darkStore.nameEn,
        nameAr: rider.darkStore.nameAr,
      },
      today: {
        delivered: today.filter((d) => d.status === 'delivered').length,
        failed: today.filter((d) => d.status === 'failed').length,
        codCollectedPiastres: today.reduce((s, d) => s + (d.codCollectedPiastres ?? 0), 0),
      },
    };
  }

  /**
   * Rider pay (CLAUDE.md "Rider pay"): the signed in rider's own wallet: earnings with the day
   * each becomes available, what they owe, and their withdrawals.
   */
  @Get('wallet')
  async wallet(@CurrentUser() user: AccessTokenClaims) {
    const rider = await this.riderOf(user);
    return riderWallet(this.prisma, rider.id);
  }

  /** Asks for money that finished its hold (one key per tap: a retry answers the same). */
  @Post('withdrawals')
  withdraw(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(withdrawalRequestSchema))
    body: z.infer<typeof withdrawalRequestSchema>,
  ) {
    return requestWithdrawal(this.prisma, { riderUserId: user.sub, body });
  }

  /** Takes back a request Accounting has not approved yet. */
  @Post('withdrawals/:id/cancel')
  cancelWithdrawal(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return cancelWithdrawal(this.prisma, { withdrawalId: id, riderUserId: user.sub });
  }

  /** The phone's position while carrying orders, shown on the customer's tracking page. */
  @Post('location')
  location(
    @CurrentUser() user: AccessTokenClaims,
    @Body(new ZodValidationPipe(riderLocationSchema)) body: z.infer<typeof riderLocationSchema>,
  ) {
    return recordRiderLocation(this.prisma, { riderUserId: user.sub, ...body });
  }

  /** Orders in the rider's hands now, plus the last day's finished ones. */
  @Get('deliveries')
  async deliveries(@CurrentUser() user: AccessTokenClaims) {
    const rider = await this.riderOf(user);
    const since = new Date(Date.now() - 24 * 3600_000);
    const list = await this.prisma.delivery.findMany({
      where: {
        riderId: rider.id,
        OR: [
          { status: { in: ['assigned', 'picked_up'] } },
          { deliveredAt: { gte: since } },
          { failedAt: { gte: since } },
        ],
      },
      include: { order: { include: { items: { include: { sku: true } } } } },
      orderBy: { assignedAt: 'desc' },
    });
    const callsNeeded = await getSetting(
      this.prisma,
      'delivery.min_calls_no_answer',
      rider.darkStoreId,
    );
    return list.map((d) => ({
      id: d.id,
      status: d.status,
      tripId: d.tripId,
      pickedUpAt: d.pickedUpAt,
      deliveredAt: d.deliveredAt,
      failedAt: d.failedAt,
      failedReason: d.failedReason,
      callAttempts: d.callAttempts,
      callsNeeded,
      returnedAt: d.returnedAt,
      codExpectedPiastres: d.codExpectedPiastres,
      codCollectedPiastres: d.codCollectedPiastres,
      order: {
        id: d.order.id,
        number: d.order.number,
        customerName: d.order.customerName,
        customerPhone: d.order.customerPhone,
        phoneFlagged: d.order.phoneFlagged,
        addressText: d.order.addressText,
        customerNote: d.order.customerNote,
        latitude: d.order.latitude,
        longitude: d.order.longitude,
        paymentMethod: d.order.paymentMethod,
        slaDueAt: d.order.slaDueAt,
        units: d.order.items.reduce((s, i) => s + i.pickedQty, 0),
        items: d.order.items
          .filter((i) => i.pickedQty > 0)
          .map((i) => ({
            sku: i.sku.sku,
            titleEn: i.sku.titleEn,
            titleAr: i.sku.titleAr,
            quantity: i.pickedQty,
          })),
      },
    }));
  }

  @Post('deliveries/:id/complete')
  async complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeDeliverySchema))
    body: z.infer<typeof completeDeliverySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const { lat, lng, ...proof } = body;
    // The position the app sent with the tap, else its last ping if it is still fresh.
    let position =
      lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : null;
    if (!position) {
      const rider = await this.riderOf(user);
      const staleMinutes = await getSetting(
        this.prisma,
        'tracking.rider_stale_minutes',
        rider.darkStoreId,
      );
      if (
        rider.lastLat != null &&
        rider.lastLng != null &&
        rider.lastLocationAt &&
        Date.now() - rider.lastLocationAt.getTime() <= staleMinutes * 60_000
      )
        position = { latitude: rider.lastLat, longitude: rider.lastLng };
    }
    await completeDelivery(this.prisma, {
      deliveryId: id,
      riderUserId: user.sub,
      ...proof,
      position,
    });
    return { status: 'delivered' };
  }

  @Post('deliveries/:id/fail')
  async fail(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(failDeliverySchema)) body: z.infer<typeof failDeliverySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return failDelivery(this.prisma, {
      deliveryId: id,
      riderUserId: user.sub,
      reason: body.reason,
      note: body.note,
      photoId: body.photoId,
    });
  }

  /** The rider is calling the customer; the call is logged as proof for a "no answer" report. */
  @Post('deliveries/:id/call')
  call(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return recordDeliveryCall(this.prisma, { deliveryId: id, riderUserId: user.sub });
  }
}
