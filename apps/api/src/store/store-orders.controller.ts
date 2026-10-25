import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  acceptOrder,
  cancelOrder,
  getOrderDetail,
  handToRider,
  listOrders,
  markItemMissing,
  type OrderDetail,
  packOrder,
  pickOrderItem,
  returnToStore,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  ACTIVE_STATUSES,
  cancelOrderSchema,
  CLOSED_STATUSES,
  handoverSchema,
  missingItemSchema,
  pickScanSchema,
} from '@shiplynow/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

const packSchema = z.object({ photoId: z.string().min(1).max(64) });

@ApiTags('store orders')
@ApiBearerAuth()
@Roles('admin', 'store_staff')
@Controller('stores/:storeId/orders')
export class StoreOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  /** The work queue (active orders by promise time) or today's finished orders. */
  @Get()
  @ApiQuery({ name: 'view', required: false, enum: ['active', 'done'] })
  async list(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AccessTokenClaims,
    @Query('view') view?: string,
  ) {
    await this.access.check(user, storeId);
    if (view === 'done') {
      const since = new Date(Date.now() - 24 * 3600_000);
      return listOrders(this.prisma, {
        darkStoreId: storeId,
        statuses: [...CLOSED_STATUSES],
        from: since,
      });
    }
    return listOrders(
      this.prisma,
      { darkStoreId: storeId, statuses: [...ACTIVE_STATUSES] },
      'promise',
    );
  }

  @Get(':orderId')
  async detail(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<OrderDetail> {
    await this.access.check(user, storeId);
    const detail = await getOrderDetail(this.prisma, orderId);
    if (!detail || detail.darkStore.id !== storeId)
      throw new NotFoundException({ error: 'order_not_found' });
    return detail;
  }

  @Post(':orderId/accept')
  async accept(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    await acceptOrder(this.prisma, { orderId, darkStoreId: storeId, actorUserId: user.sub });
    return { status: 'accepted' };
  }

  @Post(':orderId/pick')
  async pick(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(pickScanSchema)) body: z.infer<typeof pickScanSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return pickOrderItem(this.prisma, {
      orderId,
      darkStoreId: storeId,
      ...body,
      actorUserId: user.sub,
    });
  }

  @Post(':orderId/missing')
  async missing(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(missingItemSchema)) body: z.infer<typeof missingItemSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return markItemMissing(this.prisma, {
      orderId,
      darkStoreId: storeId,
      ...body,
      actorUserId: user.sub,
    });
  }

  @Post(':orderId/pack')
  async pack(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(packSchema)) body: { photoId: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    await packOrder(this.prisma, {
      orderId,
      darkStoreId: storeId,
      photoId: body.photoId,
      actorUserId: user.sub,
    });
    return { status: 'packed' };
  }

  @Post(':orderId/handover')
  async handover(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(handoverSchema)) body: { badgeCode: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return handToRider(this.prisma, {
      orderId,
      darkStoreId: storeId,
      badgeCode: body.badgeCode,
      actorUserId: user.sub,
    });
  }

  @Post(':orderId/cancel')
  async cancel(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    await cancelOrder(this.prisma, {
      orderId,
      darkStoreId: storeId,
      reason: body.reason,
      actorUserId: user.sub,
    });
    return { status: 'cancelled' };
  }

  @Post(':orderId/return')
  async returned(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return returnToStore(this.prisma, { orderId, darkStoreId: storeId, actorUserId: user.sub });
  }
}
