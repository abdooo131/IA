import { applyBp } from '../pricing/pricing.engine';
import { haversineKm, LatLng } from '../geo/geo';

export interface Stop<T> extends LatLng {
  item: T;
}

export interface RoutedStop<T> {
  item: T;
  seq: number;
  legKm: number;
  etaMinutes: number;
}

/**
 * In house routing (spec 7): nearest neighbour from the start point using straight line distance
 * times a road factor. ETA adds driving time at the configured average speed plus a buffer per stop.
 * Stops without coordinates go last in their original order.
 */
export function routeStops<T>(start: LatLng, stops: (Stop<T> | (Omit<Stop<T>, 'lat' | 'lng'> & { lat: null; lng: null }))[], cfg: { roadFactorBp: number; speedKmh: number; stopBufferMin: number }): RoutedStop<T>[] {
  const located = stops.filter((s): s is Stop<T> => s.lat !== null && s.lng !== null);
  const unknown = stops.filter((s) => s.lat === null || s.lng === null);
  const out: RoutedStop<T>[] = [];
  let here = start;
  let minutes = 0;
  const left = [...located];
  while (left.length) {
    let best = 0;
    let bestKm = Infinity;
    left.forEach((s, i) => {
      const km = haversineKm(here, s);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    const s = left.splice(best, 1)[0];
    const roadKm = applyBp(Math.round(bestKm * 1000), cfg.roadFactorBp) / 1000;
    minutes += (roadKm / Math.max(1, cfg.speedKmh)) * 60 + cfg.stopBufferMin;
    out.push({ item: s.item, seq: out.length + 1, legKm: Math.round(roadKm * 10) / 10, etaMinutes: Math.round(minutes) });
    here = s;
  }
  for (const s of unknown) {
    minutes += cfg.stopBufferMin;
    out.push({ item: s.item, seq: out.length + 1, legKm: 0, etaMinutes: Math.round(minutes) });
  }
  return out;
}
