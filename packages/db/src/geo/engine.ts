import { ADDRESS_FILLER, containsWords, normalizeAddressText } from '@shiplynow/shared';
import type { Db } from '../client';

// The area engine: reads an address, finds the named areas it mentions, and narrows level by
// level (governorate → district → neighbourhood → compound → street) until the area lies inside
// one delivery zone. Most addresses never need the exact door to choose the store.
//
//   text ──clean──▶ names found ──consistent chain──▶ deepest area ──zones it overlaps──▶
//     one zone (≥ 98% of the area)  → zone, decided
//     no zone at all (district or finer) → outside every zone, decided
//     several zones or too coarse   → unsure: ask Shopify's point, the cache, then Google

/** Share of an area that must lie in one zone to call it inside that zone. */
const INSIDE_SHARE = 0.98;
/** Names are reloaded from the database at most this often (areas change rarely). */
const NAMES_TTL_MS = 5 * 60_000;

interface NamedArea {
  id: string;
  level: number;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  aliases: string[];
}

let cache: { at: number; areas: NamedArea[] } | null = null;

/** Forgets the cached names, after an import or a new name. */
export function forgetAreaNames() {
  cache = null;
}

async function namedAreas(db: Db): Promise<NamedArea[]> {
  if (cache && Date.now() - cache.at < NAMES_TTL_MS) return cache.areas;
  const areas = await db.geoArea.findMany({
    where: { isActive: true },
    select: { id: true, level: true, parentId: true, nameEn: true, nameAr: true, aliases: true },
  });
  cache = { at: Date.now(), areas };
  return areas;
}

export interface AreaStep {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string;
}

export type EngineResult =
  | {
      status: 'zone';
      zoneId: string;
      darkStoreId: string;
      latitude: number;
      longitude: number;
      chain: AreaStep[];
      matched: string[];
    }
  | { status: 'outside'; chain: AreaStep[]; matched: string[] }
  | { status: 'unsure'; chain: AreaStep[]; matched: string[]; reason: string };

interface Hit {
  area: NamedArea;
  name: string;
}

/** The names of every area mentioned in the text, longest name kept per area. */
function findHits(text: string, areas: NamedArea[]): Hit[] {
  const hits = new Map<string, Hit>();
  for (const area of areas)
    for (const name of area.aliases) {
      if (!containsWords(text, name)) continue;
      const best = hits.get(area.id);
      if (!best || name.length > best.name.length) hits.set(area.id, { area, name });
    }
  return [...hits.values()];
}

/**
 * Picks the deepest area whose mention is backed by the rest of the address. A street or
 * compound (level 4 and 5) counts only when an area holding it is also mentioned, or when no
 * other area shares its name, because names like "El Tahrir" repeat across the city.
 */
function bestChain(hits: Hit[], byId: Map<string, NamedArea>) {
  const ancestors = (a: NamedArea) => {
    const out: NamedArea[] = [];
    let p = a.parentId ? byId.get(a.parentId) : undefined;
    while (p) {
      out.push(p);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return out;
  };
  const hitIds = new Set(hits.map((h) => h.area.id));
  const sameName = (h: Hit) => hits.filter((o) => o.name === h.name).length;
  const scored = hits
    .map((h) => {
      const up = ancestors(h.area);
      const backed = up.filter((a) => hitIds.has(a.id)).length;
      // A mentioned area that is neither above nor below this one contradicts it.
      const contradicted = hits.filter(
        (o) =>
          o.area.id !== h.area.id &&
          o.area.level < h.area.level &&
          !up.some((a) => a.id === o.area.id) &&
          o.area.level >= 2,
      ).length;
      const usable = h.area.level <= 3 || backed > 0 || sameName(h) === 1;
      // "Giza" names the governorate and a district: the word counts once, for the larger area.
      const echoesParent = up.some((a) =>
        hits.some((o) => o.area.id === a.id && o.name === h.name),
      );
      const score =
        h.area.level * 100 +
        backed * 40 -
        contradicted * 60 -
        (echoesParent ? 150 : 0) +
        h.name.length;
      return { h, up, score, usable };
    })
    .filter((s) => s.usable)
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;
  return { area: top.h.area, chain: [...top.up].reverse().concat(top.h.area) };
}

const step = (a: NamedArea): AreaStep => ({
  id: a.id,
  level: a.level,
  nameEn: a.nameEn,
  nameAr: a.nameAr,
});

/** Reads an address and decides its zone from the area map alone, when it can. */
export async function resolveByAreas(db: Db, address: string): Promise<EngineResult> {
  const text = normalizeAddressText(address);
  const areas = await namedAreas(db);
  const byId = new Map(areas.map((a) => [a.id, a]));
  const hits = findHits(text, areas);
  const matched = hits.map((h) => h.name);
  const best = bestChain(hits, byId);
  if (!best) return { status: 'unsure', chain: [], matched, reason: 'no_area_named' };
  const chain = best.chain.map(step);

  // Only the deepest area can decide: its parents are larger, so they never fit better.
  const overlap = await db.$queryRaw<
    { zoneId: string; darkStoreId: string; share: number; lat: number; lng: number }[]
  >`
    SELECT z.id AS "zoneId", z.dark_store_id AS "darkStoreId",
      ST_Area(ST_Intersection(z.area, a.geom)) / NULLIF(ST_Area(a.geom), 0) AS share,
      ST_Y(ST_PointOnSurface(ST_Intersection(z.area, a.geom))) AS lat,
      ST_X(ST_PointOnSurface(ST_Intersection(z.area, a.geom))) AS lng
    FROM zones z
    JOIN dark_stores s ON s.id = z.dark_store_id AND s.is_active AND s.kind = 'dark_store'
    JOIN geo_areas a ON a.id = ${best.area.id}
    WHERE z.is_active AND z.area IS NOT NULL AND ST_Intersects(z.area, a.geom)
    ORDER BY share DESC`;
  const inside = overlap[0];
  if (inside && inside.share >= INSIDE_SHARE)
    return {
      status: 'zone',
      zoneId: inside.zoneId,
      darkStoreId: inside.darkStoreId,
      latitude: inside.lat,
      longitude: inside.lng,
      chain,
      matched,
    };
  // Wholly outside every zone: a district or anything finer is enough to say no.
  if (overlap.length === 0 && best.area.level >= 2) return { status: 'outside', chain, matched };
  return {
    status: 'unsure',
    chain,
    matched,
    reason: overlap.length > 0 ? 'area_spans_zones' : 'too_coarse',
  };
}

/**
 * After Google placed an address, notes the words the engine did not know as a suggested name
 * for the most precise area holding Google's point. Admin approves it in the address tool.
 */
export async function learnFromPoint(
  db: Db,
  address: string,
  point: { latitude: number; longitude: number },
) {
  const text = normalizeAddressText(address);
  const areas = await namedAreas(db);
  const known = new Set(findHits(text, areas).flatMap((h) => h.name.split(' ')));
  const unknown = text
    .split(' ')
    // Plain numbers are building or flat numbers; words like "90th" or "5th" are kept.
    .filter((w) => !known.has(w) && !ADDRESS_FILLER.has(w) && !/^\d+$/.test(w) && w.length > 1);
  if (unknown.length === 0) return null;
  const [holder] = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM geo_areas
    WHERE is_active AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))
    ORDER BY level DESC, ST_Area(geom) ASC LIMIT 1`;
  if (!holder) return null;
  const phrase = unknown.slice(0, 5).join(' ');
  await db.$executeRaw`
    INSERT INTO geo_suggestions (id, phrase, area_id, sample_address, updated_at)
    VALUES (gen_random_uuid()::text, ${phrase}, ${holder.id}, ${address.slice(0, 300)}, now())
    ON CONFLICT (phrase, area_id) DO UPDATE SET seen = geo_suggestions.seen + 1, updated_at = now()`;
  return { phrase, areaId: holder.id };
}
