import { Injectable } from '@nestjs/common';
import { type DeliveryDecision, getSetting, listZonesWithArea } from '@shiplynow/db';
import type { CoverageQuery, CoverageReason } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryResolver } from './delivery-resolver.service';
import { StoreStatusService } from './store-status.service';

interface Named {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export type CoverageResult = {
  /** A real point only (the pin, or the lookup's answer); null when the area alone decided */
  location: { latitude: number; longitude: number } | null;
  /** The area the decision found, when it found one */
  area: { id: string; level: number; nameEn: string; nameAr: string } | null;
} & (
  | { covered: true; darkStore: Named; zone: Named; promiseMinutes: number }
  | { covered: false; reason: CoverageReason; darkStore?: Named; nextOpenAt?: string | null }
);

@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: DeliveryResolver,
    private readonly status: StoreStatusService,
  ) {}

  /** Coverage of a pin, a chosen area or an address text, through the one delivery decision. */
  async check(query: CoverageQuery): Promise<CoverageResult> {
    const decision = await this.resolver.resolve(
      'lat' in query
        ? { point: { latitude: query.lat, longitude: query.lng, source: 'pin' } }
        : 'areaId' in query
          ? { areaId: query.areaId }
          : { addressText: query.address },
    );
    return this.fromDecision(decision);
  }

  /**
   * Hours and capacity on top of a decision: the store that serves the place, or the nearest
   * other store whose old outline also holds the point, when that one is open and has room.
   */
  async fromDecision(decision: DeliveryDecision): Promise<CoverageResult> {
    const base = {
      location: decision.doorPoint,
      area: decision.area
        ? {
            id: decision.area.id,
            level: decision.area.level,
            nameEn: decision.area.nameEn,
            nameAr: decision.area.nameAr,
          }
        : null,
    };
    if (decision.status !== 'served' || !decision.store || !decision.zone)
      return {
        ...base,
        covered: false,
        reason: decision.status === 'unsure' ? 'address_unsure' : 'outside_zones',
      };
    const candidates = [
      { store: decision.store, zone: decision.zone },
      ...decision.alternatives.map((a) => ({ store: a.store, zone: a.zone })),
    ];
    const statuses = await this.status.statusOf([...new Set(candidates.map((c) => c.store.id))]);

    // Nearest store that is open and has room wins.
    const winner = candidates.find((c) => {
      const s = statuses.get(c.store.id)!;
      return s.openNow && !s.atCapacity;
    });
    if (winner)
      return {
        ...base,
        covered: true,
        darkStore: winner.store,
        zone: winner.zone,
        promiseMinutes: await getSetting(this.prisma, 'sla.promise_minutes', winner.store.id),
      };

    // Open but full beats closed: the customer can try again soon.
    const full = candidates.find((c) => statuses.get(c.store.id)!.openNow);
    if (full) return { ...base, covered: false, reason: 'at_capacity', darkStore: full.store };

    const soonest = candidates
      .map((c) => ({ c, at: statuses.get(c.store.id)!.nextOpenAt }))
      .sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))[0]!;
    return {
      ...base,
      covered: false,
      reason: 'store_closed',
      darkStore: soonest.c.store,
      nextOpenAt: soonest.at?.toISOString() ?? null,
    };
  }

  /** Covered area names for the storefront area picker. */
  async areas() {
    const [zones, stores] = await Promise.all([
      listZonesWithArea(this.prisma, { activeOnly: true }),
      this.prisma.darkStore.findMany({ where: { isActive: true } }),
    ]);
    return zones
      .filter((z) => z.area && z.center)
      .map((z) => {
        const s = stores.find((d) => d.id === z.darkStoreId)!;
        return {
          zoneId: z.id,
          code: z.code,
          nameEn: z.nameEn,
          nameAr: z.nameAr,
          darkStore: { id: s.id, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr },
          /** A point inside the zone; the widget sends it back to /coverage */
          point: { latitude: z.center![1], longitude: z.center![0] },
        };
      });
  }
}
