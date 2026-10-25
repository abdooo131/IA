import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  cancelOrder,
  DomainError,
  getOrderDetail,
  listOrders,
  type OrderDetail,
  recordAudit,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cancelOrderSchema,
  type CreateOrderBody,
  createOrderSchema,
  ORDER_STATUSES,
  type OrderStatus,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrderIntakeService } from '../orders/order-intake.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: OrderIntakeService,
  ) {}

  @Get('orders')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'late', required: false })
  async list(
    @Query('status') status?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('late') late?: string,
  ) {
    const date = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);
    return listOrders(this.prisma, {
      statuses: ORDER_STATUSES.includes(status as OrderStatus)
        ? [status as OrderStatus]
        : undefined,
      darkStoreId: darkStoreId || undefined,
      merchantId: merchantId || undefined,
      from: date(from),
      to: date(to),
      q: q || undefined,
      lateOnly: late === 'true',
    });
  }

  @Get('orders/:id')
  async detail(@Param('id') id: string): Promise<OrderDetail> {
    const detail = await getOrderDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'order_not_found' });
    return detail;
  }

  @Post('orders')
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    if (!body.merchantId) throw new DomainError('merchant_required', 400);
    return this.intake.create(body.merchantId, body, user.sub);
  }

  @Post('orders/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    await cancelOrder(this.prisma, { orderId: id, reason: body.reason, actorUserId: user.sub });
    return { status: 'cancelled' };
  }

  @Get('alerts')
  @ApiQuery({ name: 'open', required: false, description: 'true for unresolved only (default)' })
  async alerts(@Query('open') open?: string) {
    const alerts = await this.prisma.alert.findMany({
      where: open === 'false' ? undefined : { resolvedAt: null },
      include: {
        order: { select: { id: true, number: true, status: true } },
        darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        resolvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return alerts.map((a) => ({
      id: a.id,
      type: a.type,
      stage: a.stage,
      data: a.data as unknown,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
      resolvedBy: a.resolvedBy?.name ?? null,
      order: a.order,
      darkStore: a.darkStore,
    }));
  }

  @Post('alerts/:id/resolve')
  async resolve(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.alert.updateMany({
        where: { id, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: user.sub },
      });
      if (updated.count !== 1) throw new DomainError('alert_not_open', 409);
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'alert.resolve',
        entityType: 'alert',
        entityId: id,
        before: { resolved: false },
        after: { resolved: true },
      });
      return { resolved: true };
    });
  }
}
