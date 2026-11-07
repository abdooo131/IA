/**
 * Zones built from areas (docs/ZONES.md): the shapes the zone map, the area search and the
 * order form share, and the small rules behind their clicks.
 */

export interface AreaOwner {
  darkStoreId: string | null;
  zoneId: string | null;
  /** A row that says "not served" */
  excluded: boolean;
  /** Served through an area above it (a district), not its own row */
  inherited: boolean;
  needsReview: boolean;
}

/** One area of GET /admin/zones/areas */
export interface MapArea {
  id: string;
  level: number;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  owner: AreaOwner | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/** One row of GET /admin/zones/areas/review */
export interface ReviewArea {
  areaId: string;
  level: number;
  nameEn: string;
  nameAr: string;
  darkStoreId: string | null;
  zoneId: string | null;
  note: string | null;
}

/** One row of GET /coverage/search */
export interface ServedArea {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string;
  parent: { nameEn: string; nameAr: string } | null;
  zoneId: string;
  store: { id: string; code: string; nameEn: string; nameAr: string };
  /** [minLng, minLat, maxLng, maxLat] to frame the map on the area; never a delivery point */
  bbox?: [number, number, number, number];
}

/** The GET /coverage answer, as far as the screens use it */
export interface CoverageAnswer {
  covered: boolean;
  reason?: string;
  darkStore?: { nameEn: string; nameAr: string };
  nextOpenAt?: string | null;
  area?: { id: string; level: number; nameEn: string; nameAr: string } | null;
}

/** Map colours outside the store palette (Leaflet paints them on canvas, not through CSS). */
export const MAP_COLORS = {
  nobody: '#64748B',
  excluded: '#475569',
  review: '#D97706',
  focus: '#111827',
};

/** Districts when the map shows a large part of the city, neighbourhoods and compounds closer. */
export const NEIGHBOURHOOD_ZOOM = 13;

export function levelsForZoom(zoom: number): number[] {
  return zoom >= NEIGHBOURHOOD_ZOOM ? [2, 3, 4] : [2];
}

/**
 * What a click on an area does while a zone is selected:
 * - assign: nobody serves it, it is excluded, or another zone of the same store serves it
 * - move: another store serves it (ask first, then assign with move)
 * - unassign: it is this zone's own area (click again to remove)
 * - inherited: this zone serves it through the district; nothing to remove at this level
 */
export type AreaClick = 'assign' | 'move' | 'unassign' | 'inherited';

export function clickAction(
  owner: AreaOwner | null,
  zone: { id: string; darkStoreId: string },
): AreaClick {
  if (!owner || owner.excluded) return 'assign';
  if (owner.zoneId === zone.id) return owner.inherited ? 'inherited' : 'unassign';
  if (owner.darkStoreId && owner.darkStoreId !== zone.darkStoreId) return 'move';
  return 'assign';
}

/** Counts a zone's own areas per level: { 2: districts, 3: neighbourhoods, 4: compounds } */
export function countByLevel(areas: { level: number }[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const a of areas) counts[a.level] = (counts[a.level] ?? 0) + 1;
  return counts;
}

/** Calls `run` once typing has paused for `waitMs`; `cancel` drops a pending call. */
export function debounce<A extends unknown[]>(run: (...args: A) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call(...args: A) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run(...args);
      }, waitMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Typed text worth searching: two letters or more once trimmed. */
export function searchable(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ');
  return q.length >= 2 ? q.slice(0, 80) : null;
}

/** The /coverage query for what the form holds: the pin decides first, else the area. */
export function coverageQuery(input: {
  areaId?: string | null;
  pin?: { latitude: number; longitude: number } | null;
}): string | null {
  if (input.pin)
    return `lat=${input.pin.latitude.toFixed(6)}&lng=${input.pin.longitude.toFixed(6)}`;
  if (input.areaId) return `areaId=${encodeURIComponent(input.areaId)}`;
  return null;
}

/** Which message a coverage answer shows: a translation key under merchant.orders. */
export function coverageMessage(answer: CoverageAnswer): {
  key: 'areaOpen' | 'areaClosed' | 'areaFull' | 'areaUnsure' | 'areaOutside';
  ok: boolean;
} {
  if (answer.covered) return { key: 'areaOpen', ok: true };
  switch (answer.reason) {
    case 'store_closed':
      return { key: 'areaClosed', ok: false };
    case 'at_capacity':
      return { key: 'areaFull', ok: false };
    case 'address_unsure':
      return { key: 'areaUnsure', ok: false };
    default:
      return { key: 'areaOutside', ok: false };
  }
}

/** [minLng, minLat, maxLng, maxLat] of a GeoJSON polygon or multipolygon. */
export function boundsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings)
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng!);
      maxLng = Math.max(maxLng, lng!);
      minLat = Math.min(minLat, lat!);
      maxLat = Math.max(maxLat, lat!);
    }
  return [minLng, minLat, maxLng, maxLat] as const;
}
