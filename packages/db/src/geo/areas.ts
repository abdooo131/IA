import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAddressText } from '@shiplynow/shared';
import type { Db } from '../client';

export interface AreaInput {
  ref: string;
  level: number;
  /** The parent's ref when known; otherwise the smallest higher level area holding it is used */
  parentRef?: string | null;
  nameEn: string;
  nameAr: string;
  aliases: string[];
  source: string;
  /** GeoJSON Polygon or MultiPolygon in WGS84 */
  geometry: unknown;
}

/** Every name an area is matched by, cleaned and without duplicates. */
export function areaNames(a: { nameEn: string; nameAr: string; aliases: string[] }) {
  return [...new Set([a.nameEn, a.nameAr, ...a.aliases].map(normalizeAddressText))].filter(
    (n) => n.length >= 2,
  );
}

/**
 * Adds or refreshes one area by its ref. Names admin added (aliases not in the input) are
 * kept, so a re-import never loses what the engine has learned. Returns the area id.
 */
export async function upsertArea(db: Db, input: AreaInput): Promise<string> {
  const geometry = JSON.stringify(input.geometry);
  const names = areaNames(input);
  const existing = await db.geoArea.findUnique({ where: { ref: input.ref } });
  const aliases = [...new Set([...(existing?.aliases ?? []), ...names])];
  const [row] = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO geo_areas (id, ref, level, name_en, name_ar, aliases, source, geom, updated_at)
    VALUES (gen_random_uuid()::text, ${input.ref}, ${input.level}, ${input.nameEn}, ${input.nameAr},
      ${aliases}, ${input.source},
      ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)), 3)),
      now())
    ON CONFLICT (ref) DO UPDATE SET level = EXCLUDED.level, name_en = EXCLUDED.name_en,
      name_ar = EXCLUDED.name_ar, aliases = EXCLUDED.aliases, source = EXCLUDED.source,
      geom = EXCLUDED.geom, updated_at = now()
    RETURNING id`;
  const id = row!.id;
  const parent = input.parentRef
    ? await db.geoArea.findUnique({ where: { ref: input.parentRef }, select: { id: true } })
    : null;
  if (parent) await db.geoArea.update({ where: { id }, data: { parentId: parent.id } });
  else await linkParent(db, id);
  return id;
}

/** Sets the parent to the smallest area of a higher level that holds this area's inner point. */
export async function linkParent(db: Db, id: string) {
  await db.$executeRaw`
    UPDATE geo_areas a SET parent_id = (
      SELECT p.id FROM geo_areas p
      WHERE p.level < a.level AND p.is_active
        AND ST_Contains(p.geom, ST_PointOnSurface(a.geom))
      ORDER BY p.level DESC, ST_Area(p.geom) ASC
      LIMIT 1)
    WHERE a.id = ${id}`;
}

/**
 * Loads the governorates and districts of Greater Cairo shipped with the code
 * (prisma/geo/greater-cairo.json). Safe to run on every start: rows are refreshed by ref.
 */
export async function loadBaseAreas(db: Db) {
  const file = join(__dirname, '../../prisma/geo/greater-cairo.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    areas: (Omit<AreaInput, 'source'> & { parentRef: string | null })[];
  };
  // Parents first, so children can link to them by ref.
  const sorted = [...data.areas].sort((a, b) => a.level - b.level);
  for (const area of sorted) await upsertArea(db, { ...area, source: 'geoboundaries' });
  return { areas: sorted.length };
}
