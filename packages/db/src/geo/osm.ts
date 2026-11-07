import type { Db } from '../client';
import { forgetAreaNames } from './engine';
import { type AreaInput, upsertArea } from './areas';

// OpenStreetMap to the area map. The server asks OpenStreetMap's Overpass service for Greater
// Cairo (see apps/api geo import) and this file turns the answer into areas:
//   neighbourhoods (place=suburb/quarter/neighbourhood, admin_level 8 to 10) → level 3
//   compounds (named landuse=residential, e.g. Rehab, Madinaty)              → level 4
//   streets (named highways, one area per name inside each district)         → level 5

/** Greater Cairo: south, west, north, east */
export const GREATER_CAIRO_BBOX = [29.75, 30.85, 30.35, 31.85] as const;

type LatLon = { lat: number; lon: number };
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: LatLon[];
  members?: { type: string; role: string; geometry?: LatLon[] }[];
}

/** Neighbourhoods and compounds of a box; `out geom` gives every way its points. */
export function placesQuery(bbox: readonly number[] = GREATER_CAIRO_BBOX) {
  const b = bbox.join(',');
  return `[out:json][timeout:240];
(
  relation["boundary"="administrative"]["admin_level"~"^(8|9|10)$"](${b});
  relation["place"~"^(suburb|quarter|neighbourhood)$"](${b});
  way["place"~"^(suburb|quarter|neighbourhood)$"](${b});
  node["place"~"^(suburb|quarter|neighbourhood)$"](${b});
  way["landuse"="residential"]["name"](${b});
  relation["landuse"="residential"]["name"](${b});
);
out geom tags;`;
}

/** Named streets of one box (a district at a time keeps answers small). */
export function streetsQuery(bbox: readonly number[]) {
  return `[out:json][timeout:180];
way["highway"]["name"]["highway"!~"^(footway|path|steps|cycleway|service|track|corridor)$"](${bbox.join(',')});
out geom tags;`;
}

const ARABIC = /[؀-ۿ]/;

/** English and Arabic names plus every other name OpenStreetMap knows the place by. */
export function osmNames(tags: Record<string, string>) {
  const name = tags.name ?? '';
  const nameAr = tags['name:ar'] ?? (ARABIC.test(name) ? name : '');
  const nameEn = tags['name:en'] ?? tags.int_name ?? (ARABIC.test(name) ? '' : name);
  const aliases = [
    name,
    tags.alt_name,
    tags.old_name,
    tags.official_name,
    tags.short_name,
    tags['alt_name:ar'],
    tags['alt_name:en'],
    tags['name:arz'],
  ]
    .flatMap((n) => (n ?? '').split(';'))
    .map((n) => n.trim())
    .filter(Boolean);
  return {
    nameEn: nameEn || nameAr,
    nameAr: nameAr || nameEn,
    aliases,
  };
}

const ring = (points: LatLon[]) => points.map((p) => [p.lon, p.lat]);
const closed = (points: LatLon[]) =>
  points.length >= 4 &&
  points[0]!.lat === points.at(-1)!.lat &&
  points[0]!.lon === points.at(-1)!.lon;

/** Rough size a place known only as a point stands for, in metres. */
const POINT_RADIUS: Record<string, number> = { suburb: 900, quarter: 500, neighbourhood: 350 };

/** One area per neighbourhood or compound in the answer; unnamed or open shapes are skipped. */
export function placeAreas(elements: OsmElement[]): AreaInput[] {
  const out: AreaInput[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (!tags.name && !tags['name:ar'] && !tags['name:en']) continue;
    const level = tags.landuse === 'residential' && !tags.place ? 4 : 3;
    const names = osmNames(tags);
    const base = { ref: `osm:${el.type}/${el.id}`, level, source: 'osm', ...names };
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      const radius = POINT_RADIUS[tags.place ?? ''];
      if (radius)
        out.push({
          ...base,
          geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
          bufferMeters: radius,
        });
    } else if (el.type === 'way' && el.geometry && closed(el.geometry)) {
      out.push({ ...base, geometry: { type: 'Polygon', coordinates: [ring(el.geometry)] } });
    } else if (el.type === 'relation' && el.members) {
      const outer = el.members.filter(
        (m) => m.role !== 'inner' && m.geometry && m.geometry.length > 1,
      );
      if (outer.length)
        out.push({
          ...base,
          geometry: { type: 'MultiLineString', coordinates: outer.map((m) => ring(m.geometry!)) },
        });
    }
  }
  return out;
}

/** One area per street name inside a district: all its pieces, widened into a strip. */
export function streetAreas(
  elements: OsmElement[],
  districtRef: string,
  widthMeters = 25,
): AreaInput[] {
  const byName = new Map<string, { tags: Record<string, string>; lines: number[][][] }>();
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const key = (tags.name ?? tags['name:ar'] ?? tags['name:en'] ?? '').trim();
    if (!key) continue;
    const entry = byName.get(key) ?? { tags, lines: [] };
    entry.lines.push(ring(el.geometry));
    byName.set(key, entry);
  }
  return [...byName.entries()].map(([key, { tags, lines }]) => ({
    ref: `osm:street/${districtRef}/${key}`,
    level: 5,
    source: 'osm',
    ...osmNames(tags),
    geometry: { type: 'MultiLineString', coordinates: lines },
    bufferMeters: widthMeters / 2,
  }));
}

/** Writes areas and relinks every area's parent, since new middle levels change the tree. */
export async function saveOsmAreas(db: Db, areas: AreaInput[]) {
  let saved = 0;
  for (const area of areas) if (await upsertArea(db, area)) saved++;
  await relinkAll(db);
  forgetAreaNames();
  return { found: areas.length, saved };
}

/** Recomputes every parent link below the districts, deepest last. */
export async function relinkAll(db: Db) {
  await db.$executeRaw`
    UPDATE geo_areas a SET parent_id = (
      SELECT p.id FROM geo_areas p
      WHERE p.level < a.level AND p.is_active AND ST_Contains(p.geom, ST_PointOnSurface(a.geom))
      ORDER BY p.level DESC, ST_Area(p.geom) ASC LIMIT 1)
    WHERE a.level >= 3`;
}

/** The districts (level 2), with a box around each, to fetch streets one district at a time. */
export function districtBoxes(db: Db) {
  return db.$queryRaw<
    { id: string; ref: string; nameEn: string; s: number; w: number; n: number; e: number }[]
  >`
    SELECT id, ref, name_en AS "nameEn", ST_YMin(geom) AS s, ST_XMin(geom) AS w,
      ST_YMax(geom) AS n, ST_XMax(geom) AS e
    FROM geo_areas WHERE level = 2 AND is_active ORDER BY name_en`;
}

/**
 * Saves one district's streets, trimmed to the district's border so a street that crosses
 * into the next district is only kept where it is, and relinks the tree.
 */
export async function saveDistrictStreets(
  db: Db,
  district: { id: string; ref: string },
  elements: OsmElement[],
) {
  const areas = streetAreas(elements, district.ref);
  let saved = 0;
  for (const area of areas) if (await upsertArea(db, area)) saved++;
  const prefix = `osm:street/${district.ref}/%`;
  await db.$executeRaw`
    UPDATE geo_areas s SET geom = ST_Multi(ST_CollectionExtract(ST_Intersection(s.geom, d.geom), 3))
    FROM geo_areas d WHERE d.id = ${district.id} AND s.ref LIKE ${prefix}`;
  const removed = await db.$executeRaw`
    DELETE FROM geo_areas WHERE ref LIKE ${prefix} AND (geom IS NULL OR ST_IsEmpty(geom))`;
  await relinkAll(db);
  forgetAreaNames();
  return { found: areas.length, saved: saved - removed };
}
