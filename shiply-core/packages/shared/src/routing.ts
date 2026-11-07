// Network routing. Two kinds of place:
//   sorting facility (SF): receives pickups and returns; inbound, sorting and outbound teams
//   last mile hub (LM): belongs to one SF; delivers to consumers, sends returns back to its SF
// Merchants belong to one SF: it collects their parcels and hands their returns back.
import type { Direction } from './statuses';

export interface NetHub {
  id: string;
  isSorting: boolean;
  /** For a last mile hub: the sorting facility that feeds it. */
  parentId: string | null;
}

export interface RouteInput {
  direction: Direction;
  currentHubId: string;
  /** The merchant's sorting facility. */
  originHubId: string;
  /** The consumer's last mile hub. */
  destinationHubId: string;
}

export function targetHub(input: Pick<RouteInput, 'direction' | 'originHubId' | 'destinationHubId'>): string {
  return input.direction === 'FORWARD' ? input.destinationHubId : input.originHubId;
}

/** The sorting facility responsible for a place: itself, or a last mile hub's parent. */
export function facilityOf(hubId: string, hubs: ReadonlyMap<string, NetHub>): string {
  const hub = hubs.get(hubId);
  if (!hub) throw new Error(`Unknown hub ${hubId}`);
  if (hub.isSorting) return hub.id;
  if (!hub.parentId) throw new Error(`Last mile hub ${hubId} has no sorting facility`);
  return hub.parentId;
}

/**
 * Next place to send the parcel, or null when it is where it must leave on a courier run:
 * its last mile hub (forward) or its merchant's sorting facility (return).
 */
export function nextHop(input: RouteInput, hubs: ReadonlyMap<string, NetHub>): string | null {
  const target = targetHub(input);
  const here = input.currentHubId;
  if (here === target) return null;
  const current = hubs.get(here);
  if (!current) throw new Error(`Unknown hub ${here}`);
  if (!current.isSorting) return facilityOf(here, hubs); // a last mile hub only sends to its facility
  const targetFacility = facilityOf(target, hubs);
  if (targetFacility === here) return target; // this facility feeds the target hub
  return targetFacility; // line haul to the facility that does
}

/** Straight line distance in km between two points (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The nearest place to a point, or null when the list is empty. */
export function nearest<T extends { lat: number; lng: number }>(point: { lat: number; lng: number }, places: readonly T[]): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const km = distanceKm(point, p);
    if (km < bestKm) {
      best = p;
      bestKm = km;
    }
  }
  return best;
}
