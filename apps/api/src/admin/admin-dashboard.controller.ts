import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { computeKpis, type Kpis } from '@shiplynow/db';
import { ACTIVE_STATUSES } from '@shiplynow/shared';
import { Roles } from '../auth/decorators';
import { Clock } from '../common/clock';
import { parseRange } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  @Get('kpis')
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Cairo day YYYY-MM-DD (default 7 days ago)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Cairo day YYYY-MM-DD, included (default today)',
  })
  @ApiQuery({ name: 'darkStoreId', required: false })
  @ApiQuery({ name: 'merchantId', required: false })
  kpis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('darkStoreId') darkStoreId?: string,
    @Query('merchantId') merchantId?: string,
  ): Promise<Kpis> {
    const range = parseRange(from, to, this.clock.now());
    return computeKpis(this.prisma, {
      ...range,
      darkStoreId: darkStoreId || undefined,
      merchantId: merchantId || undefined,
    });
  }

  /** What is happening right now in every store: the queue, late orders, riders and alerts. */
  @Get('live')
  async live() {
    const now = this.clock.now();
    const [stores, orders, riders, alerts] = await Promise.all([
      this.prisma.darkStore.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameEn: true, nameAr: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        select: { darkStoreId: true, status: true, lateStage: true, slaDueAt: true },
      }),
      this.prisma.rider.findMany({
        where: { user: { isActive: true } },
        select: {
          darkStoreId: true,
          deliveries: {
            where: { status: { in: ['assigned', 'picked_up'] } },
            select: { id: true },
          },
        },
      }),
      this.prisma.alert.groupBy({
        by: ['darkStoreId'],
        where: { resolvedAt: null },
        _count: { _all: true },
      }),
    ]);
    return {
      at: now,
      stores: stores.map((s) => {
        const mine = orders.filter((o) => o.darkStoreId === s.id);
        const byStatus: Record<string, number> = {};
        for (const o of mine) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
        const crew = riders.filter((r) => r.darkStoreId === s.id);
        return {
          darkStore: s,
          active: mine.length,
          byStatus,
          late: mine.filter((o) => o.lateStage !== null).length,
          pastPromise: mine.filter((o) => o.slaDueAt && o.slaDueAt < now).length,
          riders: crew.length,
          ridersOut: crew.filter((r) => r.deliveries.length > 0).length,
          openAlerts: alerts.find((a) => a.darkStoreId === s.id)?._count._all ?? 0,
        };
      }),
    };
  }
}
