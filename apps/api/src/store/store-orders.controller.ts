import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  acceptOrder,
  addOrderNote,
  cancelOrder,
  decideFailedOrder,
  getOrderDetail,
  handToRider,
  listOrderNotes,
  listOrders,
  markItemMissing,
  type OrderDetail,
  packOrder,
  pickOrderItem,
  returnToStore,
} from '@shiplynow/db';
import {
  type AccessProfile,
  type AccessTokenClaims,
  ACTIVE_STATUSES,
  canDo,
  cancelOrderSchema,
  CLOSED_STATUSES,
  type FailedOrderDecision,
  failedOrderDecisionSchema,
  handoverSchema,
  missingItemSchema,
  type OrderNoteBody,
  orderNoteSchema,
  pickScanSchema,
  WAITING_STATUSES,
} from '@shiplynow/shared';
import { z } from 'zod';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from './store-access.service';

const packSchema = z.object({
  photoId: z.string().min(1).max(64),
  /** The box size chosen at packing (optional), on top of the packaging recipe */
  boxItemId: z.string().min(1).max(64).optional(),
});

@ApiTags('store orders')
@ApiBearerAuth()
@Access('store')
@Controller('stores/:storeId/orders')
export class StoreOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StoreAccessService,
  ) {}

  /** The work queue (active orders by promise time, and failed attempts waiting) or today's finished orders. */
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
      { darkStoreId: storeId, statuses: [...ACTIVE_STATUSES, ...WAITING_STATUSES] },
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

  /** Both note threads of an order of this store (team notes and the merchant thread). */
  @Get(':orderId/notes')
  async notes(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.inStore(storeId, orderId, user);
    return listOrderNotes(this.prisma, orderId, ['team', 'merchant']);
  }

  @Post(':orderId/notes')
  async addNote(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(orderNoteSchema)) body: OrderNoteBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.inStore(storeId, orderId, user);
    return addOrderNote(this.prisma, {
      orderId,
      audience: body.audience,
      body: body.body,
      authorUserId: user.sub,
    });
  }

  private async inStore(storeId: string, orderId: string, user: AccessTokenClaims) {
    await this.access.check(user, storeId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { darkStoreId: true },
    });
    if (!order || order.darkStoreId !== storeId)
      throw new NotFoundException({ error: 'order_not_found' });
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
    @Body(new ZodValidationPipe(packSchema)) body: z.infer<typeof packSchema>,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    const packaging = await packOrder(this.prisma, {
      orderId,
      darkStoreId: storeId,
      photoId: body.photoId,
      boxItemId: body.boxItemId,
      actorUserId: user.sub,
    });
    return { status: 'packed', packagingShort: packaging.short.length > 0 };
  }

  @Post(':orderId/handover')
  async handover(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(handoverSchema)) body: z.infer<typeof handoverSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.access.check(user, storeId);
    // Past the rider's cash limit only a store manager (store manage) may hand over, with a reason.
    if (body.cashOverrideReason && !canDo(access, 'store', 'manage'))
      throw new ForbiddenException({ error: 'no_access' });
    return handToRider(this.prisma, {
      orderId,
      darkStoreId: storeId,
      badgeCode: body.badgeCode,
      cashOverrideReason: body.cashOverrideReason,
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

  /** After a failed attempt: try again (goods must be back), ship normally or cancel. */
  @Post(':orderId/decision')
  async decide(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(failedOrderDecisionSchema)) body: FailedOrderDecision,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await this.access.check(user, storeId);
    return decideFailedOrder(this.prisma, {
      orderId,
      darkStoreId: storeId,
      decision: body,
      actorUserId: user.sub,
    });
  }
}
