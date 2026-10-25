import { Injectable } from '@nestjs/common';
import { coveringZones, getSetting, listZonesWithArea } from '@shiplynow/db';
import type { CoverageQuery, CoverageReason } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Geocoder } from './geocoding';
import { StoreStatusService } from './store-status.service';

interface Named {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

export type CoverageResult = {
  location: { latitude: number; longitude: number; formattedAddress?: string } | null;
} & (
  | { covered: true; darkStore: Named; zone: Named; promiseMinutes: number }
  | { covered: false; reason: CoverageReason; darkStore?: Named; nextOpenAt?: string | null }
);

@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoder: Geocoder,
    private readonly status: StoreStatusService,
  ) {}

  async check(query: CoverageQuery): Promise<CoverageResult> {
    let location: CoverageResult['location'];
    if ('address' in query) {
      const found = await this.geocoder.geocode(query.address);
      if (!found) return { covered: false, reason: 'outside_zones', location: null };
      location = found;
    } else {
      location = { latitude: query.lat, longitude: query.lng };
    }

    const candidates = await coveringZones(this.prisma, location);
    if (candidates.length === 0) return { covered: false, reason: 'outside_zones', location };

    const statuses = await this.status.statusOf([...new Set(candidates.map((c) => c.darkStoreId))]);
    const store = (c: (typeof candidates)[number]): Named => ({
      id: c.darkStoreId,
      code: c.darkStoreCode,
      nameEn: c.darkStoreNameEn,
      nameAr: c.darkStoreNameAr,
    });

    // Nearest store that is open and has room wins.
    const winner = candidates.find((c) => {
      const s = statuses.get(c.darkStoreId)!;
      return s.openNow && !s.atCapacity;
    });
    if (winner) {
      return {
        covered: true,
        location,
        darkStore: store(winner),
        zone: {
          id: winner.zoneId,
          code: winner.zoneCode,
          nameEn: winner.zoneNameEn,
          nameAr: winner.zoneNameAr,
        },
        promiseMinutes: await getSetting(this.prisma, 'sla.promise_minutes', winner.darkStoreId),
      };
    }

    // Open but full beats closed: the customer can try again soon.
    const full = candidates.find((c) => statuses.get(c.darkStoreId)!.openNow);
    if (full) return { covered: false, reason: 'at_capacity', location, darkStore: store(full) };

    const soonest = candidates
      .map((c) => ({ c, at: statuses.get(c.darkStoreId)!.nextOpenAt }))
      .sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))[0]!;
    return {
      covered: false,
      reason: 'store_closed',
      location,
      darkStore: store(soonest.c),
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
