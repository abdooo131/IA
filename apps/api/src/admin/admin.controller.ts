import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { Ctx, Roles } from '../common/decorators';
import { ADMINS, ORDER_STAFF } from '../common/roles';
import { parse } from '../common/zod';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('config')
  @Roles(...ADMINS, 'FINANCE')
  listConfig() {
    return this.config.list();
  }

  @Patch('config/:key')
  @Roles(...ADMINS)
  updateConfig(@Ctx() ctx: RequestContext, @Param('key') key: string, @Body() body: unknown) {
    const b = parse(z.object({ value: z.unknown(), reason: z.string().trim().max(300).optional() }), body);
    return this.config.update(ctx, key, b.value, b.reason);
  }

  @Get('audit')
  @Roles(...ADMINS, 'FINANCE')
  auditLog(@Ctx() ctx: RequestContext, @Query() q: Record<string, string>) {
    return this.audit.list(ctx, {
      entityType: q.entityType,
      entityId: q.entityId,
      action: q.action,
      take: q.take ? parseInt(q.take, 10) : undefined,
      cursor: q.cursor,
    });
  }

  @Get('merchants')
  @Roles(...ORDER_STAFF)
  merchants(@Ctx() ctx: RequestContext) {
    return this.prisma.withContext(ctx, (tx) => tx.merchant.findMany({ where: { archived: false }, orderBy: { nameEn: 'asc' } }));
  }

  @Get('hubs')
  @Roles(...ORDER_STAFF)
  hubs() {
    return this.prisma.hub.findMany({ where: { archived: false }, orderBy: { code: 'asc' } });
  }

  @Get('pricing')
  @Roles(...ADMINS, 'FINANCE')
  async pricing() {
    const [zones, sizes, tiers, overrides] = await Promise.all([
      this.prisma.pricingZonePrice.findMany({ orderBy: [{ pickupZone: 'asc' }, { destZone: 'asc' }] }),
      this.prisma.pricingSizeAdjustment.findMany(),
      this.prisma.pricingTierAdjustment.findMany(),
      this.prisma.pricingOverride.findMany(),
    ]);
    return { zones, sizes, tiers, overrides };
  }
}
