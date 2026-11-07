import { Injectable } from '@nestjs/common';
import { getSetting } from '@shiplynow/db';
import { isOpenAt, nextOpeningAt } from '@shiplynow/shared';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

export interface StoreStatus {
  openNow: boolean;
  nextOpenAt: Date | null;
  ordersLastHour: number;
  capacityPerHour: number;
  atCapacity: boolean;
}

/** Orders in these states no longer use the store's hourly capacity. */
const NOT_COUNTED = ['cancelled', 'moved_to_standard'] as const;

@Injectable()
export class StoreStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Opening and capacity status for each store, at the current time. */
  async statusOf(darkStoreIds: string[]): Promise<Map<string, StoreStatus>> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 60 * 60_000);
    const [hours, orderCounts] = await Promise.all([
      this.prisma.storeHours.findMany({ where: { darkStoreId: { in: darkStoreIds } } }),
      this.prisma.order.groupBy({
        by: ['darkStoreId'],
        where: {
          darkStoreId: { in: darkStoreIds },
          placedAt: { gte: since },
          status: { notIn: [...NOT_COUNTED] },
        },
        _count: { _all: true },
      }),
    ]);

    const result = new Map<string, StoreStatus>();
    for (const id of darkStoreIds) {
      const week = hours.filter((h) => h.darkStoreId === id);
      const openNow = isOpenAt(week, now);
      const ordersLastHour = orderCounts.find((c) => c.darkStoreId === id)?._count._all ?? 0;
      const capacityPerHour = await getSetting(this.prisma, 'store.capacity_orders_per_hour', id);
      result.set(id, {
        openNow,
        nextOpenAt: openNow ? null : nextOpeningAt(week, now),
        ordersLastHour,
        capacityPerHour,
        atCapacity: ordersLastHour >= capacityPerHour,
      });
    }
    return result;
  }
}
