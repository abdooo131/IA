import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  cancelOrder,
  computeKpis,
  DomainError,
  getOrderDetail,
  listOrders,
  type OrderDetail,
} from '@shiplynow/db';
import {
  type AccessTokenClaims,
  type CreateOrderBody,
  createOrderSchema,
  ORDER_STATUSES,
  type OrderStatus,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { OrderIntakeService } from '../orders/order-intake.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('merchant')
@ApiBearerAuth()
@Roles('merchant')
@Controller('merchant/orders')
export class MerchantOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: OrderIntakeService,
    private readonly clock: Clock,
  ) {}

  private async merchantIdOf(user: AccessTokenClaims) {
    const me = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!me?.merchantId) throw new ForbiddenException({ error: 'no_merchant' });
    return me.merchantId;
  }

  /** The merchant's own numbers for their home page: totals and orders per day. */
  @Get('kpis')
  @ApiQuery({ name: 'from', required: false, description: 'Cairo day, default 13 days ago' })
  @ApiQuery({ name: 'to', required: false, description: 'Cairo day, included, default today' })
  async kpis(
    @CurrentUser() user: AccessTokenClaims,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const merchantId = await this.merchantIdOf(user);
    const kpis = await computeKpis(this.prisma, {
      ...parseRange(from, to, this.clock.now(), 13),
      merchantId,
    });
    return { from: kpis.from, to: kpis.to, totals: kpis.totals, perDay: kpis.perDay };
  }

  @Get()
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'q', required: false })
  async list(
    @CurrentUser() user: AccessTokenClaims,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    const merchantId = await this.merchantIdOf(user);
    const statuses = ORDER_STATUSES.includes(status as OrderStatus)
      ? [status as OrderStatus]
      : undefined;
    return listOrders(this.prisma, { merchantId, statuses, q: q || undefined });
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenClaims,
  ): Promise<Omit<OrderDetail, 'deliveryOtp'>> {
    const merchantId = await this.merchantIdOf(user);
    const detail = await getOrderDetail(this.prisma, id);
    if (!detail || detail.merchant.id !== merchantId) throw new DomainError('order_not_found', 404);
    // Merchants see the outcome but not the customer's delivery code.
    const { deliveryOtp, ...visible } = detail;
    return visible;
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderBody,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.intake.create(await this.merchantIdOf(user), body, user.sub);
  }

  /** Merchants may cancel only before the store starts picking. */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const merchantId = await this.merchantIdOf(user);
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || order.merchantId !== merchantId) throw new DomainError('order_not_found', 404);
    if (order.status !== 'new' && order.status !== 'accepted')
      throw new DomainError('too_late_to_cancel');
    await cancelOrder(this.prisma, {
      orderId: id,
      reason: 'merchant_cancelled',
      actorUserId: user.sub,
    });
    return { status: 'cancelled' };
  }
}
