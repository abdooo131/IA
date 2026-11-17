import { foldPlaceText, normalizeAddressText } from '@shiplynow/shared';
import type { Db } from '../client';
import { recomputeZoneArea } from './zone-areas';

// Data clean up of the area map (docs/ZONES.md section 4). Run by the seed and at every API
// start, after the base areas are loaded: every step only changes what is still wrong, so a
// second run changes nothing.

/** Words that only say "city" around a place's name ("El Shorouk City", "مدينة الشروق"). */
const CITY_WORDS = new Set(['city', 'مدينه', 'el', 'al']);

const bareName = (name: string) =>
  foldPlaceText(normalizeAddressText(name))
    .split(' ')
    .filter((w) => w && !CITY_WORDS.has(w))
    .join(' ');

/**
 * Moves every reference from `fromId` to `intoId` (children, customers, suggestions, orders,
 * store rows) and marks `fromId` merged and inactive.
 */
async function mergeArea(db: Db, fromId: string, intoId: string) {
  await db.$executeRaw`UPDATE geo_areas SET parent_id = ${intoId} WHERE parent_id = ${fromId}`;
  await db.$executeRaw`UPDATE customers SET district_id = ${intoId} WHERE district_id = ${fromId}`;
  await db.$executeRaw`UPDATE orders SET geo_area_id = ${intoId} WHERE geo_area_id = ${fromId}`;
  await db.$executeRaw`
    UPDATE geo_suggestions s SET area_id = ${intoId} WHERE s.area_id = ${fromId}
      AND NOT EXISTS (SELECT 1 FROM geo_suggestions k WHERE k.area_id = ${intoId} AND k.phrase = s.phrase)`;
  await db.$executeRaw`DELETE FROM geo_suggestions WHERE area_id = ${fromId}`;
  // The kept area's own row wins; the merged one's moves over when the kept area has none.
  await db.$executeRaw`
    UPDATE store_areas SET geo_area_id = ${intoId} WHERE geo_area_id = ${fromId}
      AND NOT EXISTS (SELECT 1 FROM store_areas k WHERE k.geo_area_id = ${intoId})`;
  await db.$executeRaw`DELETE FROM store_areas WHERE geo_area_id = ${fromId}`;
  await db.$executeRaw`
    UPDATE geo_areas SET is_active = false, merged_into_id = ${intoId}, updated_at = now()
    WHERE id = ${fromId}`;
}

/** Adds the names of `fromIds` to `intoId`, keeping what it has. */
async function addNames(db: Db, intoId: string, fromIds: string[]) {
  await db.$executeRaw`
    UPDATE geo_areas k SET aliases = ARRAY(
      SELECT DISTINCT n FROM (
        SELECT unnest(k.aliases) AS n
        UNION SELECT unnest(a.aliases) FROM geo_areas a WHERE a.id = ANY(${fromIds})) x)
    WHERE k.id = ${intoId}`;
}

export interface CleanUpResult {
  /** Duplicate districts merged into the one kept */
  mergedDistricts: number;
  /** Districts whose shape took in its merged pieces again (after a reload of the base map) */
  reshaped: number;
  /** Neighbourhoods and compounds given a district (or governorate) by where they lie */
  parented: number;
  /** Large areas below a district that are that district under another name (El Shorouk City) */
  foldedIntoDistrict: number;
}

/**
 * The clean up: merges duplicate districts (pieces of one district with the same name, kept as
 * one row whose shape is all of them), gives neighbourhoods and compounds without a district
 * the district holding most of them, and folds areas that are a district under another name
 * ("El Shorouk City" filed as a compound) into that district. Zones using a changed shape are
 * recomputed.
 */
export async function cleanUpAreas(db: Db): Promise<CleanUpResult> {
  const result: CleanUpResult = {
    mergedDistricts: 0,
    reshaped: 0,
    parented: 0,
    foldedIntoDistrict: 0,
  };
  const touched = new Set<string>();

  // 1. Duplicate districts: same English name under the same governorate.
  const groups = await db.$queryRaw<{ ids: string[] }[]>`
    SELECT array_agg(a.id ORDER BY
      (SELECT count(*) FROM geo_areas c WHERE c.parent_id = a.id) DESC,
      ST_Area(a.geom) DESC, a.id) AS ids
    FROM geo_areas a WHERE a.level = 2 AND a.is_active
    GROUP BY a.name_en, a.parent_id HAVING count(*) > 1`;
  for (const g of groups) {
    const [keep, ...rest] = g.ids as [string, ...string[]];
    await addNames(db, keep, rest);
    for (const id of rest) await mergeArea(db, id, keep);
    result.mergedDistricts += rest.length;
  }

  // 2. A kept district's shape is all of its pieces (a reload of the base map resets it).
  const reshaped = await db.$queryRaw<{ id: string }[]>`
    WITH parts AS (
      SELECT k.id, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(ST_Union(m.geom), k.geom)), 3)) AS g
      FROM geo_areas k JOIN geo_areas m ON m.merged_into_id = k.id
      WHERE k.is_active
      GROUP BY k.id, k.geom
      HAVING ST_Area(ST_Difference(ST_Union(m.geom), k.geom)) > 1e-9
    )
    UPDATE geo_areas a SET geom = parts.g, updated_at = now() FROM parts WHERE a.id = parts.id
    RETURNING a.id`;
  result.reshaped = reshaped.length;
  for (const r of reshaped) touched.add(r.id);

  // 3. "El Shorouk City" filed as a compound covering a fifth of El Shorouk: the district's own
  //    name, so its names go to the district and the row is folded into it.
  const pairs = await db.$queryRaw<
    { id: string; nameEn: string; nameAr: string; districtId: string; dEn: string; dAr: string }[]
  >`
    SELECT a.id, a.name_en AS "nameEn", a.name_ar AS "nameAr", d.id AS "districtId",
      d.name_en AS "dEn", d.name_ar AS "dAr"
    FROM geo_areas a JOIN geo_areas d ON d.level = 2 AND d.is_active AND ST_Intersects(a.geom, d.geom)
    WHERE a.level IN (3, 4) AND a.is_active
      AND ST_Area(a.geom) >= 0.2 * ST_Area(d.geom)
      AND ST_Area(ST_Intersection(a.geom, d.geom)) >= 0.5 * ST_Area(a.geom)`;
  for (const p of pairs) {
    const same = bareName(p.nameEn) === bareName(p.dEn) || bareName(p.nameAr) === bareName(p.dAr);
    if (!same) continue;
    await addNames(db, p.districtId, [p.id]);
    await mergeArea(db, p.id, p.districtId);
    result.foldedIntoDistrict++;
  }

  // 4. Neighbourhoods and compounds without a district: the district holding most of them
  //    (at least half), else the governorate holding their inner point when they have none.
  const parented = await db.$queryRaw<{ id: string }[]>`
    WITH lost AS (
      SELECT a.id, a.geom FROM geo_areas a LEFT JOIN geo_areas p ON p.id = a.parent_id
      WHERE a.level IN (3, 4) AND a.is_active AND (p.id IS NULL OR p.level < 2 OR NOT p.is_active)
    ),
    best AS (
      SELECT DISTINCT ON (lost.id) lost.id, d.id AS district
      FROM lost JOIN geo_areas d ON d.level = 2 AND d.is_active AND ST_Intersects(d.geom, lost.geom)
      WHERE ST_Area(ST_Intersection(d.geom, lost.geom)) >= 0.5 * ST_Area(lost.geom)
      ORDER BY lost.id, ST_Area(ST_Intersection(d.geom, lost.geom)) DESC
    )
    UPDATE geo_areas a SET parent_id = best.district, updated_at = now()
    FROM best WHERE a.id = best.id
    RETURNING a.id`;
  const orphans = await db.$queryRaw<{ id: string }[]>`
    UPDATE geo_areas a SET parent_id = (
      SELECT g.id FROM geo_areas g WHERE g.level = 1 AND g.is_active
        AND ST_Contains(g.geom, ST_PointOnSurface(a.geom)) LIMIT 1), updated_at = now()
    WHERE a.level IN (3, 4) AND a.is_active AND a.parent_id IS NULL
      AND EXISTS (SELECT 1 FROM geo_areas g WHERE g.level = 1 AND g.is_active
        AND ST_Contains(g.geom, ST_PointOnSurface(a.geom)))
    RETURNING a.id`;
  result.parented = parented.length + orphans.length;
  for (const r of [...parented, ...orphans]) touched.add(r.id);

  // Zones whose areas changed shape or place in the tree draw their polygon again.
  if (result.mergedDistricts || result.foldedIntoDistrict || touched.size) {
    const zones = await db.$queryRaw<{ zoneId: string }[]>`
      SELECT DISTINCT zone_id AS "zoneId" FROM store_areas WHERE zone_id IS NOT NULL`;
    for (const z of zones) await recomputeZoneArea(db, z.zoneId);
  }
  return result;
}
