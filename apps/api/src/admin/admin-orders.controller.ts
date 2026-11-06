import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  cancelOrder,
  decideFailedOrder,
  DomainError,
  getOrderDetail,
  listOrders,
  type OrderDetail,
  recordAudit,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  cancelOrderSchema,
  type FailedOrderDecision,
  failedOrderDecisionSchema,
  type CreateOrderBody,
  createOrderSchema,
  ORDER_STATUSES,
  type OrderStatus,
  type AccessProfile,
  canDo,
} from '@shiplynow/shared';
import type { Response } from 'express';
import { assertStore, storeFilter } from '../auth/access-scope';
import { Access, CurrentAccess, CurrentUser } from '../auth/decorators';
import { parseBound } from '../common/dates';
import { ordersCsv } from './orders-csv';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrderIntakeService } from '../orders/order-intake.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Access('operations')
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
    @CurrentAccess() access: AccessProfile,
    @Query('status') status?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('late') late?: string,
  ) {
    return listOrders(
      this.prisma,
      this.filter(access, { status, darkStoreId, merchantId, from, to, q, late }),
    );
  }

  /** The same list as a CSV file for Excel (UTF-8 with BOM so Arabic shows correctly). */
  @Get('orders/export.csv')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'late', required: false })
  async exportCsv(
    @Res() res: Response,
    @CurrentAccess() access: AccessProfile,
    @Query('status') status?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('late') late?: string,
  ) {
    const orders = await listOrders(this.prisma, {
      ...this.filter(access, { status, darkStoreId, merchantId, from, to, q, late }),
      take: 1000,
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="shiply-orders.csv"');
    res.send(ordersCsv(orders));
  }

  private filter(
    access: AccessProfile,
    f: {
      status?: string;
      darkStoreId?: string;
      merchantId?: string;
      from?: string;
      to?: string;
      q?: string;
      late?: string;
    },
  ) {
    const { status, darkStoreId, merchantId, from, to, q, late } = f;
    return {
      statuses: ORDER_STATUSES.includes(status as OrderStatus)
        ? [status as OrderStatus]
        : undefined,
      darkStoreId: storeFilter(access, darkStoreId),
      merchantId: merchantId || undefined,
      from: parseBound(from, 'from'),
      to: parseBound(to, 'to'),
      q: q || undefined,
      lateOnly: late === 'true',
    };
  }

  @Get('orders/:id')
  async detail(
    @Param('id') id: string,
    @CurrentAccess() access: AccessProfile,
  ): Promise<OrderDetail> {
    const detail = await getOrderDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'order_not_found' });
    await this.orderIn(id, access);
    return detail;
  }

  @Post('orders')
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!body.merchantId) throw new DomainError('merchant_required', 400);
    return this.intake.create(body.merchantId, body, user.sub, 'manual', (darkStoreId) =>
      assertStore(access, darkStoreId),
    );
  }

  @Post('orders/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: { reason: string },
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const order = await this.orderIn(id, access);
    // Once picking has started, cancelling undoes store work: operations manage.
    if (
      order &&
      !['new', 'accepted'].includes(order.status) &&
      !canDo(access, 'operations', 'manage')
    )
      throw new ForbiddenException({ error: 'no_access' });
    await cancelOrder(this.prisma, { orderId: id, reason: body.reason, actorUserId: user.sub });
    return { status: 'cancelled' };
  }

  @Post('orders/:id/decision')
  async decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(failedOrderDecisionSchema)) body: FailedOrderDecision,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    await this.orderIn(id, access);
    return decideFailedOrder(this.prisma, { orderId: id, decision: body, actorUserId: user.sub });
  }

  @Get('alerts')
  @ApiQuery({ name: 'open', required: false, description: 'true for unresolved only (default)' })
  async alerts(@CurrentAccess() access: AccessProfile, @Query('open') open?: string) {
    const alerts = await this.prisma.alert.findMany({
      where: {
        ...(open !== 'false' && { resolvedAt: null }),
        // People limited to some stores see only those stores' alerts.
        darkStoreId: storeFilter(access),
      },
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
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      select: { darkStoreId: true },
    });
    if (alert) assertStore(access, alert.darkStoreId);
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

  /** The order's store must be one of the person's stores (404 is left to the caller). */
  private async orderIn(id: string, access: AccessProfile) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { darkStoreId: true, status: true },
    });
    if (order) assertStore(access, order.darkStoreId);
    return order;
  }
}
