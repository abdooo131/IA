import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  customerProfile,
  customerRisk,
  customersOverview,
  districtDemand,
  DomainError,
  listCustomers,
  mergeCustomers,
  recordAudit,
} from '@shiplynow/db';
import { z } from 'zod';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const mergeSchema = z.object({ mergeId: z.string().min(1).max(64) });

/**
 * One customer base across every merchant: each person with what they buy, from whom and
 * when. Names, phones and emails are personal data: admin only, and opening a profile is
 * written to the audit log.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('segment') segment?: string,
    @Query('governorate') governorate?: string,
    @Query('merchantId') merchantId?: string,
    @Query('due') due?: string,
    @Query('page') page?: string,
  ) {
    return listCustomers(this.prisma, {
      q: q?.slice(0, 100),
      segment,
      governorate,
      merchantId,
      due: due === '1' || due === 'true',
      page: Number.parseInt(page ?? '1', 10) || 1,
    });
  }

  @Get('overview')
  overview() {
    return customersOverview(this.prisma);
  }

  /** Customers and spend by district against our zones: where a new dark store pays. */
  @Get('places')
  places() {
    return districtDemand(this.prisma);
  }

  /** The person behind one of our orders, with their cash on delivery risk (admin order page). */
  @Get('by-order/:orderId')
  async byOrder(@Param('orderId') orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customer: { select: { id: true, name: true, phone: true } } },
    });
    if (!order) throw new DomainError('order_not_found', 404);
    if (!order.customer) return { customer: null };
    return {
      customer: order.customer,
      risk: await customerRisk(this.prisma, order.customer.id),
    };
  }

  /** Joins another profile of the same person into this one (audited). */
  @Post(':id/merge')
  merge(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mergeSchema)) body: { mergeId: string },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return mergeCustomers(this.prisma, {
      keepId: id,
      mergeId: body.mergeId,
      actorUserId: user.sub,
    });
  }

  @Get(':id')
  async profile(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) {
    const profile = await customerProfile(this.prisma, id);
    if (!profile) throw new DomainError('customer_not_found', 404);
    await recordAudit(this.prisma, {
      actorUserId: user.sub,
      action: 'customer.view',
      entityType: 'customer',
      entityId: id,
    });
    return profile;
  }
}
