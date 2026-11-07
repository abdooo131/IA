import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  customerProfile,
  customerRisk,
  customersOverview,
  districtDemand,
  DomainError,
  exportCustomers,
  listCustomers,
  mergeCustomers,
  recordAudit,
} from '@shiplynow/db';
import type { Response } from 'express';
import { z } from 'zod';
import type { AccessTokenClaims } from '@shiplynow/shared';
import { Access, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cairoStamp, csv } from '../finance/finance-csv';
import { PrismaService } from '../prisma/prisma.service';

const mergeSchema = z.object({ mergeId: z.string().min(1).max(64) });

/**
 * One customer base across every merchant: each person with what they buy, from whom and
 * when. Names, phones and emails are personal data: admin only, and opening a profile is
 * written to the audit log.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Access('customers')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Named rows (name, phone, email): customer_data too. */
  @Get()
  @Access('customers', 'view', { customerData: true })
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

  /**
   * One segment (or every customer) as a CSV: phone, email, name, segment, marketing consent
   * and last order. "For marketing" keeps only people who agreed, and of them only the channel
   * they agreed to. Audited with the row count.
   */
  @Get('export')
  @Access('customers', 'view', { customerData: true })
  async export(
    @CurrentUser() user: AccessTokenClaims,
    @Res() res: Response,
    @Query('segment') segment?: string,
    @Query('marketing') marketing?: string,
  ) {
    const forMarketing = marketing === '1' || marketing === 'true';
    const rows = await exportCustomers(this.prisma, { segment, marketing: forMarketing });
    await recordAudit(this.prisma, {
      actorUserId: user.sub,
      action: 'customer.export',
      entityType: 'customer',
      entityId: 'export',
      after: { segment: segment ?? null, marketing: forMarketing, rows: rows.length },
    });
    const name = `shiply-customers-${segment || 'all'}${forMarketing ? '-marketing' : ''}.csv`;
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '')}"`);
    res.send(
      csv(
        ['phone', 'email', 'name', 'segment', 'email_marketing', 'sms_marketing', 'last_order'],
        rows.map((r) => [
          r.phone,
          r.email,
          r.name,
          r.segment,
          r.emailMarketing,
          r.smsMarketing,
          r.lastOrderAt ? cairoStamp(r.lastOrderAt) : null,
        ]),
      ),
    );
  }

  /** Customers and spend by district against our zones: where a new dark store pays. */
  @Get('places')
  places() {
    return districtDemand(this.prisma);
  }

  /** The person behind one of our orders, with their cash on delivery risk (admin order page). */
  @Get('by-order/:orderId')
  @Access('customers', 'view', { customerData: true })
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
  @Access('customers', 'manage', { customerData: true })
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
  @Access('customers', 'view', { customerData: true })
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
