// Who serves an area, following the family of places upwards. Pure, so the map page and the
// lookup used by other modules give the same answer.

interface ServiceRow {
  placeId: string;
  zoneId: string | null;
  darkStoreId: string | null;
  notServed: boolean;
}
interface ZoneRow {
  id: string;
  hubId: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
interface SiteRow {
  id: string;
  kind: string;
  code: string;
  nameEn: string;
  nameAr: string;
  sortingFacilityId: string | null;
}
type Brief = { id: string; code: string; nameEn: string; nameAr: string };

export interface AreaServiceAnswer {
  notServed: boolean;
  zone: Brief | null;
  hub: Brief | null;
  facility: Brief | null;
  darkStore: Brief | null;
  /** the area above whose setting was used, when not the place's own */
  zoneFrom: string | null;
  darkStoreFrom: string | null;
}

const brief = (x?: Brief | null): Brief | null => (x ? { id: x.id, code: x.code, nameEn: x.nameEn, nameAr: x.nameAr } : null);

export function resolveService(
  placeId: string,
  parents: Map<string, string | null>,
  services: Map<string, ServiceRow>,
  zones: ZoneRow[],
  sites: SiteRow[],
): AreaServiceAnswer {
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const siteById = new Map(sites.map((s) => [s.id, s]));
  let zone: ZoneRow | undefined;
  let zoneFrom: string | null = null;
  let store: SiteRow | undefined;
  let storeFrom: string | null = null;
  const seen = new Set<string>();
  for (let cur: string | null | undefined = placeId; cur && !seen.has(cur); cur = parents.get(cur)) {
    seen.add(cur);
    const s = services.get(cur);
    if (!s) continue;
    if (s.notServed) {
      return { notServed: true, zone: null, hub: null, facility: null, darkStore: null, zoneFrom: null, darkStoreFrom: null };
    }
    if (!zone && s.zoneId && zoneById.has(s.zoneId)) {
      zone = zoneById.get(s.zoneId);
      zoneFrom = cur === placeId ? null : cur;
    }
    if (!store && s.darkStoreId && siteById.get(s.darkStoreId)?.kind === 'dark_store') {
      store = siteById.get(s.darkStoreId);
      storeFrom = cur === placeId ? null : cur;
    }
    if (zone && store) break;
  }
  const hub = zone ? siteById.get(zone.hubId) : undefined;
  const facility = hub?.sortingFacilityId ? siteById.get(hub.sortingFacilityId) : undefined;
  return { notServed: false, zone: brief(zone), hub: brief(hub), facility: brief(facility), darkStore: brief(store), zoneFrom, darkStoreFrom: storeFrom };
}
