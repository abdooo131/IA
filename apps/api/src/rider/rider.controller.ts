import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { completeDelivery, failDelivery } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  completeDeliverySchema,
  failDeliverySchema,
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
    return {
      name: rider.user.name,
      badgeCode: rider.badgeCode,
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
    return list.map((d) => ({
      id: d.id,
      status: d.status,
      tripId: d.tripId,
      pickedUpAt: d.pickedUpAt,
      deliveredAt: d.deliveredAt,
      failedAt: d.failedAt,
      failedReason: d.failedReason,
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
    await completeDelivery(this.prisma, { deliveryId: id, riderUserId: user.sub, ...body });
    return { status: 'delivered' };
  }

  @Post('deliveries/:id/fail')
  async fail(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(failDeliverySchema)) body: z.infer<typeof failDeliverySchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await failDelivery(this.prisma, {
      deliveryId: id,
      riderUserId: user.sub,
      reason: body.reason,
      note: body.note,
    });
    return { status: 'failed' };
  }
}
