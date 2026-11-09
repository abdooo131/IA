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
  acceptOrder,
  addOrderNote,
  cancelOrder,
  decideFailedOrder,
  DomainError,
  getOrderDetail,
  getOrderMoney,
  listOrderNotes,
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
  type OrderNoteBody,
  orderNoteSchema,
  bulkCancelOrdersSchema,
  bulkIdsSchema,
  type DocSmartButton,
} from '@shiplynow/shared';
import type { z } from 'zod';
import { eachRecord } from '../common/bulk';
import type { Response } from 'express';
import { assertMerchant, assertStore, merchantFilter, storeFilter } from '../auth/access-scope';
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
      merchantId: merchantFilter(access, merchantId || undefined),
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
    await this.orderIn(id, access);
    const detail = await getOrderDetail(this.prisma, id);
    if (!detail) throw new NotFoundException({ error: 'order_not_found' });
    return detail;
  }

  /** Both note threads of the order: the team's internal notes and the merchant thread. */
  @Get('orders/:id/notes')
  async notes(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    if (!(await this.orderIn(id, access)))
      throw new NotFoundException({ error: 'order_not_found' });
    return listOrderNotes(this.prisma, id, ['team', 'merchant']);
  }

  @Post('orders/:id/notes')
  async addNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(orderNoteSchema)) body: OrderNoteBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!(await this.orderIn(id, access)))
      throw new NotFoundException({ error: 'order_not_found' });
    return addOrderNote(this.prisma, {
      orderId: id,
      audience: body.audience,
      body: body.body,
      authorUserId: user.sub,
    });
  }

  /** The order's fees and where its money stands, from the ledger (accounting view). */
  @Get('orders/:id/money')
  @Access('accounting', 'view')
  async money(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    if (!(await this.orderIn(id, access)))
      throw new NotFoundException({ error: 'order_not_found' });
    return getOrderMoney(this.prisma, id);
  }

  @Post('orders')
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderBody,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (!body.merchantId) throw new DomainError('merchant_required', 400);
    assertMerchant(access, body.merchantId);
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
    await this.cancelOne(id, body.reason, user, access);
    return { status: 'cancelled' };
  }

  private async cancelOne(
    id: string,
    reason: string,
    user: AccessTokenClaims,
    access: AccessProfile,
  ) {
    const order = await this.orderIn(id, access);
    // Once picking has started, cancelling undoes store work: operations manage.
    if (
      order &&
      !['new', 'accepted'].includes(order.status) &&
      !canDo(access, 'operations', 'manage')
    )
      throw new ForbiddenException({ error: 'no_access' });
    await cancelOrder(this.prisma, { orderId: id, reason, actorUserId: user.sub });
  }

  /**
   * Accept several new orders from the list (as store staff do one by one): each order is
   * checked on its own (the person's stores and merchants, still new) in its own transaction.
   */
  @Post('orders/bulk-accept')
  bulkAccept(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      const order = await this.orderIn(id, access);
      if (!order) throw new DomainError('order_not_found', 404);
      await acceptOrder(this.prisma, {
        orderId: id,
        darkStoreId: order.darkStoreId,
        actorUserId: user.sub,
      });
    });
  }

  /** Cancel several orders with one reason; each under the single cancel rules. */
  @Post('orders/bulk-cancel')
  bulkCancel(
    @Body(new ZodValidationPipe(bulkCancelOrdersSchema))
    body: z.infer<typeof bulkCancelOrdersSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      if (!(await this.prisma.order.count({ where: { id } })))
        throw new DomainError('order_not_found', 404);
      await this.cancelOne(id, body.note, user, access);
    });
  }

  /**
   * The order's document frame (UX phase C): smart buttons with counts of what hangs off it,
   * each only when the person may open it, and its photos for the chatter's attachments.
   */
  @Get('orders/:id/document')
  async document(@Param('id') id: string, @CurrentAccess() access: AccessProfile) {
    if (!(await this.orderIn(id, access)))
      throw new NotFoundException({ error: 'order_not_found' });
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        customerId: true,
        customerName: true,
        packPhotoId: true,
        packedAt: true,
        merchant: { select: { id: true, name: true } },
        darkStore: { select: { id: true, code: true } },
        deliveries: {
          select: {
            proofPhotoId: true,
            failedPhotoId: true,
            deliveredAt: true,
            failedAt: true,
            rider: { select: { user: { select: { name: true } } } },
          },
          orderBy: { assignedAt: 'asc' },
        },
        _count: { select: { notes: true, alerts: true, ledgerEntries: true } },
      },
    });
    const smart: DocSmartButton[] = [];
    if (canDo(access, 'merchants', 'view'))
      smart.push({
        key: 'merchant',
        count: null,
        value: o.merchant.name,
        href: `/admin/merchants/${o.merchant.id}`,
      });
    if (o.customerId && canDo(access, 'customers', 'view') && access.customerData)
      smart.push({
        key: 'customer',
        count: null,
        value: o.customerName,
        href: `/admin/customers/${o.customerId}`,
      });
    smart.push({
      key: 'store',
      count: null,
      value: o.darkStore.code,
      href: `/admin/orders?f=&v=store:${o.darkStore.id}`,
    });
    if (canDo(access, 'accounting', 'view')) {
      const only =
        o._count.ledgerEntries === 1
          ? await this.prisma.ledgerEntry.findFirst({
              where: { orderId: id },
              select: { id: true },
            })
          : null;
      smart.push({
        key: 'entries',
        count: o._count.ledgerEntries,
        href: only
          ? `/finance/journal/${only.id}`
          : `/finance/journal?f=&q=${encodeURIComponent(o.number)}`,
      });
    }
    const attachments: { photoId: string; at: string; by: string | null; kind: string }[] = [];
    if (o.packPhotoId)
      attachments.push({
        photoId: o.packPhotoId,
        at: (o.packedAt ?? new Date()).toISOString(),
        by: null,
        kind: 'pack',
      });
    for (const d of o.deliveries) {
      if (d.proofPhotoId)
        attachments.push({
          photoId: d.proofPhotoId,
          at: (d.deliveredAt ?? new Date()).toISOString(),
          by: d.rider.user.name,
          kind: 'delivery',
        });
      if (d.failedPhotoId)
        attachments.push({
          photoId: d.failedPhotoId,
          at: (d.failedAt ?? new Date()).toISOString(),
          by: d.rider.user.name,
          kind: 'door',
        });
    }
    smart.push({ key: 'photos', count: attachments.length, href: '#attachments' });
    smart.push({ key: 'notes', count: o._count.notes, href: '#notes' });
    smart.push({
      key: 'alerts',
      count: o._count.alerts,
      href: `/admin/alerts?f=&q=${encodeURIComponent(o.number)}`,
    });
    return { number: o.number, smart, attachments };
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
    const merchants = merchantFilter(access);
    const alerts = await this.prisma.alert.findMany({
      where: {
        ...(open !== 'false' && { resolvedAt: null }),
        // People limited to some stores see only those stores' alerts.
        darkStoreId: storeFilter(access),
        // Employee document alerts belong to HR, sales follow ups to the sales managers.
        type: {
          notIn: [
            ...(!canDo(access, 'hr', 'view') ? ['document_expiring', 'document_expired'] : []),
            ...(!canDo(access, 'sales', 'manage')
              ? ['crm_followup_overdue', 'crm_deal_stale']
              : []),
          ],
        },
        // Account managers get the alerts of their merchants (docs/HR.md 5).
        ...(merchants && {
          OR: [{ merchantId: merchants }, { order: { merchantId: merchants } }],
        }),
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
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return this.resolveOne(id, user, access);
  }

  /** Mark several alerts as handled from the list; each is checked and audited on its own. */
  @Post('alerts/bulk-resolve')
  bulkResolve(
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    return eachRecord(body.ids, async (id) => {
      if (!(await this.prisma.alert.count({ where: { id } })))
        throw new DomainError('alert_not_found', 404);
      await this.resolveOne(id, user, access);
    });
  }

  private async resolveOne(id: string, user: AccessTokenClaims, access: AccessProfile) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      select: { darkStoreId: true, merchantId: true, order: { select: { merchantId: true } } },
    });
    if (alert) {
      assertStore(access, alert.darkStoreId);
      if (access.ownMerchantsOnly)
        assertMerchant(access, alert.merchantId ?? alert.order?.merchantId ?? null);
    }
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
      select: { darkStoreId: true, status: true, merchantId: true },
    });
    if (order) {
      assertStore(access, order.darkStoreId);
      assertMerchant(access, order.merchantId);
    }
    return order;
  }
}
