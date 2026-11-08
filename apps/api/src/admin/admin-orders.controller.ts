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
} from '@shiplynow/shared';
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

  /**
   * One alerts list for both companies (docs/MERGE.md step 6): Shiply Now's alerts for people
   * with Operations, Shiply's network alerts for people with Shiply (office wide, not limited
   * to some stores or merchants). company filters to one of them.
   */
  @Get('alerts')
  @Access(['operations', 'shiply'])
  @ApiQuery({ name: 'open', required: false, description: 'true for unresolved only (default)' })
  @ApiQuery({ name: 'company', required: false, description: 'shiply_now or shiply' })
  async alerts(
    @CurrentAccess() access: AccessProfile,
    @Query('open') open?: string,
    @Query('company') company?: string,
  ) {
    const merchants = merchantFilter(access);
    const showNow = company !== 'shiply' && canDo(access, 'operations', 'view');
    const showNetwork =
      company !== 'shiply_now' &&
      canDo(access, 'shiply', 'view') &&
      access.allStores &&
      !access.ownMerchantsOnly;
    const alerts = !showNow
      ? []
      : await this.prisma.alert.findMany({
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
    const now = alerts.map((a) => ({
      id: a.id,
      company: 'shiply_now' as const,
      type: a.type,
      stage: a.stage,
      data: a.data as unknown,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
      resolvedBy: a.resolvedBy?.name ?? null,
      order: a.order,
      darkStore: a.darkStore,
    }));
    if (!showNetwork) return now;
    const network = await this.prisma.networkAlert.findMany({
      where: open !== 'false' ? { status: 'OPEN' } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: network.map((a) => a.resolvedById).filter((x): x is string => !!x) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const shiply = network.map((a) => ({
      // Network alerts carry their own ids; the prefix tells resolve where to look.
      id: `nw_${a.id}`,
      company: 'shiply' as const,
      type: 'network',
      stage: null,
      data: {
        kind: a.kind,
        message: a.message,
        severity: a.severity,
        entity: a.entity,
        entityId: a.entityId,
      } as unknown,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
      resolvedBy: a.resolvedById ? (names.get(a.resolvedById) ?? null) : null,
      order: null,
      darkStore: null,
    }));
    return [...now, ...shiply]
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
      .slice(0, 200);
  }

  @Post('alerts/:id/resolve')
  @Access(['operations', 'shiply'])
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
    @CurrentAccess() access: AccessProfile,
  ) {
    if (id.startsWith('nw_')) return this.resolveNetwork(id.slice(3), user.sub, access);
    if (!canDo(access, 'operations', 'use')) throw new DomainError('no_access', 403);
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
  /** A Shiply network alert handled from the one list (Shiply use). */
  private async resolveNetwork(id: string, userId: string, access: AccessProfile) {
    if (!canDo(access, 'shiply', 'use') || !access.allStores)
      throw new DomainError('no_access', 403);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.networkAlert.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: userId },
      });
      if (updated.count !== 1) throw new DomainError('alert_not_open', 409);
      await recordAudit(tx, {
        actorUserId: userId,
        action: 'alert.resolve',
        entityType: 'network_alert',
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
