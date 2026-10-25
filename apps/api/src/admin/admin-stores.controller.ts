import { Body, Controller, Get, NotFoundException, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { recordAudit, setSetting } from '@shiplynow/db';
import {
  type AccessTokenClaims,
  capacitySchema,
  type WeekHours,
  weekHoursSchema,
} from '@shiplynow/shared';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StoreStatusService } from '../coverage/store-status.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/dark-stores')
export class AdminStoresController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly status: StoreStatusService,
  ) {}

  @Get()
  async list() {
    const stores = await this.prisma.darkStore.findMany({
      orderBy: { code: 'asc' },
      include: {
        hours: { orderBy: { weekday: 'asc' } },
        _count: { select: { zones: true } },
      },
    });
    const [totals, statuses] = await Promise.all([
      this.prisma.stockLevel.groupBy({
        by: ['darkStoreId'],
        where: { onHand: { gt: 0 } },
        _sum: { onHand: true, reserved: true },
        _count: { _all: true },
      }),
      this.status.statusOf(stores.map((s) => s.id)),
    ]);
    return stores.map(({ _count, hours, ...store }) => {
      const t = totals.find((x) => x.darkStoreId === store.id);
      const s = statuses.get(store.id)!;
      return {
        ...store,
        hours: hours.map(({ weekday, opensMinute, closesMinute, isClosed }) => ({
          weekday,
          opensMinute,
          closesMinute,
          isClosed,
        })),
        zoneCount: _count.zones,
        skusInStock: t?._count._all ?? 0,
        unitsOnHand: t?._sum.onHand ?? 0,
        unitsReserved: t?._sum.reserved ?? 0,
        ...s,
        nextOpenAt: s.nextOpenAt?.toISOString() ?? null,
      };
    });
  }

  @Put(':id/hours')
  async setHours(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(weekHoursSchema)) week: WeekHours,
    @CurrentUser() user: AccessTokenClaims,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.darkStore.findUnique({ where: { id } });
      if (!store) throw new NotFoundException({ error: 'dark_store_not_found' });
      const before = await tx.storeHours.findMany({
        where: { darkStoreId: id },
        orderBy: { weekday: 'asc' },
      });
      for (const day of week) {
        const { weekday, ...rest } = day;
        await tx.storeHours.upsert({
          where: { darkStoreId_weekday: { darkStoreId: id, weekday } },
          create: { darkStoreId: id, weekday, ...rest },
          update: rest,
        });
      }
      const sorted = [...week].sort((a, b) => a.weekday - b.weekday);
      await recordAudit(tx, {
        actorUserId: user.sub,
        action: 'dark_store.hours_update',
        entityType: 'dark_store',
        entityId: id,
        before: before.map(({ weekday, opensMinute, closesMinute, isClosed }) => ({
          weekday,
          opensMinute,
          closesMinute,
          isClosed,
        })),
        after: sorted,
      });
      return { hours: sorted };
    });
  }

  @Put(':id/capacity')
  async setCapacity(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(capacitySchema)) body: { value: number },
    @CurrentUser() user: AccessTokenClaims,
  ) {
    const store = await this.prisma.darkStore.findUnique({ where: { id } });
    if (!store) throw new NotFoundException({ error: 'dark_store_not_found' });
    await setSetting(this.prisma, {
      key: 'store.capacity_orders_per_hour',
      scope: id,
      value: body.value,
      actorUserId: user.sub,
    });
    return { capacityPerHour: body.value };
  }
}
