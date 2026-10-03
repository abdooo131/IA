import { Inject, Injectable } from '@nestjs/common';
import type { PricingZone } from '@shiply/shared';
import { ConfigService } from '../config/config.service';
import { Tx } from '../prisma/prisma.service';
import { haversineKm } from './geo';
import { GEOCODER, GeocodeRequest, GeocoderAdapter, GeocodeResult } from './geocoder.adapter';

export interface ZoneDetection {
  geocode: GeocodeResult | null;
  zone: PricingZone;
  hubId: string | null;
  needsManualHub: boolean;
}

/**
 * Phase 1 zone detection: geocode, then pricing zone from the matched area (override) or governorate,
 * then the nearest hub with dispatches_last_mile in the same pricing zone within the configured radius.
 * Phase 2 replaces the hub step with PostGIS polygons.
 */
@Injectable()
export class ZoneService {
  constructor(@Inject(GEOCODER) private readonly geocoder: GeocoderAdapter, private readonly config: ConfigService) {}

  async detect(tx: Tx, req: GeocodeRequest, opts: { withHub: boolean }): Promise<ZoneDetection> {
    const gov = await tx.governorate.findUniqueOrThrow({ where: { code: req.governorateCode } });
    const geocode = await this.geocoder.geocode(tx, req);
    let zone = gov.pricingZone as PricingZone;
    if (geocode?.areaId) {
      const area = await tx.area.findUnique({ where: { id: geocode.areaId } });
      if (area?.pricingZone) zone = area.pricingZone as PricingZone;
    }
    if (!opts.withHub) return { geocode, zone, hubId: null, needsManualHub: false };

    const maxKm = await this.config.getInt('zones.max_hub_distance_km', tx);
    const hubs = await tx.hub.findMany({
      where: { dispatchesLastMile: true, archived: false, governorate: { pricingZone: zone } },
    });
    let best: { id: string; km: number } | null = null;
    if (geocode) {
      for (const h of hubs) {
        const km = haversineKm(geocode, h);
        if (km <= maxKm && (!best || km < best.km)) best = { id: h.id, km };
      }
    }
    return { geocode, zone, hubId: best?.id ?? null, needsManualHub: !best };
  }
}
