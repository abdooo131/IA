// Network routing. Two kinds of place:
//   sorting facility (SF): receives pickups and returns; inbound, sorting and outbound teams
//   last mile hub (LM): belongs to one SF; delivers to consumers, sends returns back to its SF
// Merchants belong to one SF: it collects their parcels and hands their returns back.
// Between SFs, trucks run on line haul links. A parcel goes merchant -> nearest SF -> (up to two
// SFs in between) -> the SF that feeds the customer's hub -> that last mile hub -> customer.
// With no links set up at all, every SF is taken to reach every other one directly.
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

/** A truck route from one sorting facility to another. */
export interface LineHaul {
  fromId: string;
  toId: string;
}

/** At most this many facilities between the first and the last one. */
export const MAX_TRANSFERS = 2;

/**
 * The facilities a parcel passes through, from one to another, fewest legs first. Null when no
 * chain of line haul links joins them within the limit.
 */
export function facilityPath(fromId: string, toId: string, links: readonly LineHaul[]): string[] | null {
  if (fromId === toId) return [fromId];
  if (links.length === 0) return [fromId, toId];
  const next = new Map<string, string[]>();
  for (const l of links) next.set(l.fromId, [...(next.get(l.fromId) ?? []), l.toId]);
  const prev = new Map<string, string>([[fromId, '']]);
  let frontier = [fromId];
  for (let legs = 0; legs <= MAX_TRANSFERS && frontier.length; legs++) {
    const following: string[] = [];
    for (const here of frontier) {
      for (const to of next.get(here) ?? []) {
        if (prev.has(to)) continue;
        prev.set(to, here);
        if (to === toId) {
          const path = [to];
          let at = here;
          while (at) {
            path.unshift(at);
            at = prev.get(at)!;
          }
          return path;
        }
        following.push(to);
      }
    }
    frontier = following;
  }
  return null;
}

/**
 * The whole planned way of a parcel through our network, as place ids: the merchant's facility,
 * any facilities in between, the facility that feeds the target hub, then the hub itself.
 */
export function planRoute(input: Pick<RouteInput, 'direction' | 'originHubId' | 'destinationHubId'>, hubs: ReadonlyMap<string, NetHub>, links: readonly LineHaul[] = []): string[] | null {
  const forward = input.direction === 'FORWARD';
  const start = forward ? input.originHubId : facilityOf(input.destinationHubId, hubs);
  const target = targetHub(input);
  const path = facilityPath(facilityOf(start, hubs), facilityOf(target, hubs), links);
  if (!path) return null;
  const route = forward ? path : [input.destinationHubId, ...path].filter((x, i, a) => a.indexOf(x) === i);
  if (route[route.length - 1] !== target) route.push(target);
  return route;
}

/**
 * Next place to send the parcel, or null when it is where it must leave on a courier run:
 * its last mile hub (forward) or its merchant's sorting facility (return).
 */
export function nextHop(input: RouteInput, hubs: ReadonlyMap<string, NetHub>, links: readonly LineHaul[] = []): string | null {
  const target = targetHub(input);
  const here = input.currentHubId;
  if (here === target) return null;
  const current = hubs.get(here);
  if (!current) throw new Error(`Unknown hub ${here}`);
  if (!current.isSorting) return facilityOf(here, hubs); // a last mile hub only sends to its facility
  const targetFacility = facilityOf(target, hubs);
  if (targetFacility === here) return target; // this facility feeds the target hub
  const path = facilityPath(here, targetFacility, links);
  if (!path) throw new Error(`No line haul joins ${here} to ${targetFacility}`);
  return path[1]!; // the next facility on the way
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
