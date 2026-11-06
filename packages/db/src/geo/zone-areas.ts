import { normalizeAddressText } from '@shiplynow/shared';
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../audit';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import type { ZoneGeometry } from '../zones';

// Zones are built from areas (docs/ZONES.md section 1). store_areas says which store and zone
// serve an area; an area without a row of its own is served by its nearest ancestor's row, and
// a row with no store marks the area (and everything inside it) as not served. A zone's
// polygon is the union of its areas minus the areas inside them served elsewhere; it is stored
// on zones.area and recomputed in the same transaction as every change, so point checks and
// maps keep working. A zone that never had an area keeps the outline drawn before.

/** Areas from this level down to compounds may be assigned (never governorates or streets). */
const ASSIGNABLE_LEVELS = [2, 3, 4];

export interface AreaOwner {
  /** The area whose row decides (the area itself or its nearest ancestor with a row) */
  ownerAreaId: string;
  darkStoreId: string | null;
  zoneId: string | null;
  /** True when the row belongs to an ancestor */
  inherited: boolean;
  needsReview: boolean;
}

/** Who serves each area: its own row or its nearest ancestor's. Areas without one are left out. */
export async function areaOwners(db: Db, areaIds: string[]): Promise<Map<string, AreaOwner>> {
  const out = new Map<string, AreaOwner>();
  if (areaIds.length === 0) return out;
  const rows = await db.$queryRaw<
    {
      start: string;
      ownerAreaId: string;
      darkStoreId: string | null;
      zoneId: string | null;
      depth: number;
      needsReview: boolean;
    }[]
  >`
    WITH RECURSIVE up AS (
      SELECT a.id AS start, a.id AS cur, a.parent_id, 0 AS depth
      FROM geo_areas a WHERE a.id = ANY(${areaIds})
      UNION ALL
      SELECT up.start, p.id, p.parent_id, up.depth + 1
      FROM up JOIN geo_areas p ON p.id = up.parent_id
      WHERE up.depth < 10 AND NOT EXISTS (SELECT 1 FROM store_areas s WHERE s.geo_area_id = up.cur)
    )
    SELECT DISTINCT ON (up.start) up.start, s.geo_area_id AS "ownerAreaId",
      s.dark_store_id AS "darkStoreId", s.zone_id AS "zoneId", up.depth,
      s.needs_review AS "needsReview"
    FROM up JOIN store_areas s ON s.geo_area_id = up.cur
    ORDER BY up.start, up.depth`;
  for (const r of rows)
    out.set(r.start, {
      ownerAreaId: r.ownerAreaId,
      darkStoreId: r.darkStoreId,
      zoneId: r.zoneId,
      inherited: r.depth > 0,
      needsReview: r.needsReview,
    });
  return out;
}

/** True when some area inside `areaId` is served by another zone or marked not served. */
export async function hasOtherOwnersInside(db: Db, areaId: string, zoneId: string | null) {
  const [row] = await db.$queryRaw<{ found: boolean }[]>`
    WITH RECURSIVE up AS (
      SELECT s.geo_area_id AS start, a.parent_id AS cur, 0 AS depth
      FROM store_areas s JOIN geo_areas a ON a.id = s.geo_area_id
      WHERE s.zone_id IS DISTINCT FROM ${zoneId}
      UNION ALL
      SELECT up.start, a.parent_id, up.depth + 1 FROM up JOIN geo_areas a ON a.id = up.cur
      WHERE up.cur IS NOT NULL AND up.depth < 10
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE cur = ${areaId}) AS found`;
  return row?.found ?? false;
}

/**
 * Recomputes a zone's polygon from its areas: each assigned area minus the areas inside it
 * that another zone serves or that are marked not served; null when nothing is left.
 */
export async function recomputeZoneArea(db: Db, zoneId: string) {
  await db.$executeRaw`
    WITH RECURSIVE mine AS (
      SELECT s.geo_area_id AS id FROM store_areas s WHERE s.zone_id = ${zoneId}
    ),
    up AS (
      SELECT s.geo_area_id AS start, a.parent_id AS cur, 0 AS depth
      FROM store_areas s JOIN geo_areas a ON a.id = s.geo_area_id
      WHERE s.zone_id IS DISTINCT FROM ${zoneId}
      UNION ALL
      SELECT up.start, a.parent_id, up.depth + 1 FROM up JOIN geo_areas a ON a.id = up.cur
      WHERE up.cur IS NOT NULL AND up.depth < 10
    ),
    cut AS (
      SELECT up.cur AS mine_id, ST_Union(o.geom) AS geom
      FROM up JOIN mine ON mine.id = up.cur JOIN geo_areas o ON o.id = up.start
      GROUP BY up.cur
    ),
    pieces AS (
      SELECT CASE WHEN cut.geom IS NULL THEN a.geom
        ELSE ST_Difference(a.geom, cut.geom) END AS g
      FROM mine JOIN geo_areas a ON a.id = mine.id LEFT JOIN cut ON cut.mine_id = mine.id
    ),
    total AS (
      SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(g)), 3)) AS g FROM pieces
    )
    UPDATE zones SET
      area = (SELECT CASE WHEN g IS NULL OR ST_IsEmpty(g) THEN NULL ELSE g END FROM total),
      updated_at = now()
    WHERE id = ${zoneId}`;
}

/** The zones whose polygon depends on this area: its own row's zone and its ancestors' zones. */
async function zonesAround(db: Db, areaId: string) {
  const rows = await db.$queryRaw<{ zoneId: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 0 AS depth FROM geo_areas WHERE id = ${areaId}
      UNION ALL
      SELECT p.id, p.parent_id, up.depth + 1 FROM up JOIN geo_areas p ON p.id = up.parent_id
      WHERE up.depth < 10
    )
    SELECT DISTINCT s.zone_id AS "zoneId" FROM up JOIN store_areas s ON s.geo_area_id = up.id
    WHERE s.zone_id IS NOT NULL`;
  return rows.map((r) => r.zoneId);
}

async function lockedArea(tx: Prisma.TransactionClient, areaId: string) {
  const area = await tx.geoArea.findUnique({
    where: { id: areaId },
    select: { id: true, level: true, isActive: true, nameEn: true, nameAr: true },
  });
  if (!area || !area.isActive) throw new DomainError('area_not_found', 404);
  if (!ASSIGNABLE_LEVELS.includes(area.level))
    throw new DomainError('area_level_not_assignable', 400);
  // One change to an area at a time.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'store_area:' + areaId}))`;
  return area;
}

const ownerJson = (o: { darkStoreId: string | null; zoneId: string | null } | null) =>
  o ? { darkStoreId: o.darkStoreId, zoneId: o.zoneId } : null;

async function recompute(tx: Prisma.TransactionClient, zoneIds: (string | null | undefined)[]) {
  for (const id of new Set(zoneIds.filter((z): z is string => !!z)))
    await recomputeZoneArea(tx, id);
}

export interface AssignAreaInput {
  areaId: string;
  zoneId: string;
  /** Take the area from the store serving it now (its own row or an area above it) */
  move?: boolean;
  actorUserId: string | null;
  note?: string | null;
}

/**
 * Serves an area from a zone. Refused for hubs, for areas another store serves (unless `move`),
 * and for governorates and streets. The zone polygons around it are recomputed in the same
 * transaction, and the change is audited.
 */
export async function assignArea(tx: Prisma.TransactionClient, input: AssignAreaInput) {
  const area = await lockedArea(tx, input.areaId);
  const zone = await tx.zone.findUnique({
    where: { id: input.zoneId },
    include: { darkStore: { select: { id: true, kind: true } } },
  });
  if (!zone) throw new DomainError('zone_not_found', 404);
  if (zone.darkStore.kind !== 'dark_store') throw new DomainError('hub_has_no_zones', 409);
  const owner = (await areaOwners(tx, [area.id])).get(area.id) ?? null;
  const own = await tx.storeArea.findUnique({ where: { geoAreaId: area.id } });
  if (owner?.darkStoreId && owner.darkStoreId !== zone.darkStoreId && !input.move)
    throw new DomainError('area_served_by_other_store', 409);
  if (own?.zoneId === zone.id && !own.needsReview) return { changed: false, areaId: area.id };
  const before = await zonesAround(tx, area.id);
  await tx.storeArea.upsert({
    where: { geoAreaId: area.id },
    create: {
      geoAreaId: area.id,
      darkStoreId: zone.darkStoreId,
      zoneId: zone.id,
      note: input.note ?? null,
      createdById: input.actorUserId,
    },
    update: {
      darkStoreId: zone.darkStoreId,
      zoneId: zone.id,
      needsReview: false,
      note: input.note ?? null,
      createdById: input.actorUserId,
    },
  });
  await recompute(tx, [...before, zone.id, own?.zoneId]);
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'store_area.assign',
    entityType: 'geo_area',
    entityId: area.id,
    before: { own: ownerJson(own), servedBy: ownerJson(owner) },
    after: { darkStoreId: zone.darkStoreId, zoneId: zone.id, moved: !!input.move },
  });
  return { changed: true, areaId: area.id };
}

/** Removes an area's own row, so it is served (or not) like the area above it again. */
export async function unassignArea(
  tx: Prisma.TransactionClient,
  input: { areaId: string; actorUserId: string | null },
) {
  const area = await lockedArea(tx, input.areaId);
  const own = await tx.storeArea.findUnique({ where: { geoAreaId: area.id } });
  if (!own) return { changed: false, areaId: area.id };
  const before = await zonesAround(tx, area.id);
  await tx.storeArea.delete({ where: { geoAreaId: area.id } });
  await recompute(tx, [...before, own.zoneId]);
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'store_area.unassign',
    entityType: 'geo_area',
    entityId: area.id,
    before: ownerJson(own),
    after: null,
  });
  return { changed: true, areaId: area.id };
}

/** Marks an area as not served, even when an area above it is. */
export async function excludeArea(
  tx: Prisma.TransactionClient,
  input: { areaId: string; actorUserId: string | null; note?: string | null },
) {
  const area = await lockedArea(tx, input.areaId);
  const own = await tx.storeArea.findUnique({ where: { geoAreaId: area.id } });
  if (own && own.darkStoreId === null) return { changed: false, areaId: area.id };
  const before = await zonesAround(tx, area.id);
  await tx.storeArea.upsert({
    where: { geoAreaId: area.id },
    create: {
      geoAreaId: area.id,
      note: input.note ?? null,
      createdById: input.actorUserId,
    },
    update: {
      darkStoreId: null,
      zoneId: null,
      needsReview: false,
      note: input.note ?? null,
      createdById: input.actorUserId,
    },
  });
  await recompute(tx, [...before, own?.zoneId]);
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'store_area.exclude',
    entityType: 'geo_area',
    entityId: area.id,
    before: ownerJson(own),
    after: { darkStoreId: null, zoneId: null },
  });
  return { changed: true, areaId: area.id };
}

/**
 * "Select the areas inside this shape": assigns to the zone every area of the given level
 * lying at least `minShare` inside the shape. Areas another store serves are skipped (listed)
 * unless `move`. Returns what was assigned and what was skipped.
 */
export async function assignAreasInShape(
  tx: Prisma.TransactionClient,
  input: {
    zoneId: string;
    shape: ZoneGeometry;
    level: number;
    minShare?: number;
    move?: boolean;
    actorUserId: string | null;
  },
) {
  if (!ASSIGNABLE_LEVELS.includes(input.level))
    throw new DomainError('area_level_not_assignable', 400);
  const json = JSON.stringify(input.shape);
  const [valid] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)) AS ok`;
  if (!valid?.ok) throw new DomainError('zone_geometry_invalid', 400);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH s AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326) AS g)
    SELECT a.id FROM geo_areas a, s
    WHERE a.is_active AND a.level = ${input.level} AND ST_Intersects(a.geom, s.g)
      AND ST_Area(ST_Intersection(a.geom, s.g)) / NULLIF(ST_Area(a.geom), 0) >= ${input.minShare ?? 0.6}
    ORDER BY a.id LIMIT 2000`;
  const assigned: string[] = [];
  const skipped: { areaId: string; error: string }[] = [];
  for (const r of rows) {
    try {
      const done = await assignArea(tx, {
        areaId: r.id,
        zoneId: input.zoneId,
        move: input.move,
        actorUserId: input.actorUserId,
      });
      if (done.changed) assigned.push(r.id);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      skipped.push({ areaId: r.id, error: error.code });
    }
  }
  return { assigned, skipped };
}

export interface MapArea {
  id: string;
  level: number;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  /** Who serves it: its own row or an area above it; null when nobody does */
  owner: {
    darkStoreId: string | null;
    zoneId: string | null;
    excluded: boolean;
    inherited: boolean;
    needsReview: boolean;
  } | null;
  /** Simplified GeoJSON (Multi)Polygon */
  geometry: unknown;
}

/**
 * Areas for the zone map: inside a box or a district, levels 2 to 4 by default, with who serves
 * each, simplified shapes and a cursor for the next page.
 */
export async function listAreasForMap(
  db: Db,
  input: {
    bbox?: [number, number, number, number] | null;
    districtId?: string | null;
    levels?: number[];
    q?: string | null;
    cursor?: string | null;
    limit?: number;
  },
) {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);
  const levels = (input.levels?.length ? input.levels : [2, 3, 4]).filter((l) => l >= 1 && l <= 5);
  const [minLng, minLat, maxLng, maxLat] = input.bbox ?? [0, 0, 0, 0];
  const useBox = !!input.bbox;
  const q = input.q ? normalizeAddressText(input.q) : '';
  const rows = await db.$queryRaw<
    {
      id: string;
      level: number;
      parentId: string | null;
      nameEn: string;
      nameAr: string;
      geometry: string;
    }[]
  >`
    WITH RECURSIVE inside AS (
      SELECT id, 0 AS depth FROM geo_areas WHERE id = ${input.districtId ?? ''}
      UNION ALL
      SELECT c.id, inside.depth + 1 FROM geo_areas c JOIN inside ON c.parent_id = inside.id
      WHERE inside.depth < 6
    )
    SELECT a.id, a.level, a.parent_id AS "parentId", a.name_en AS "nameEn", a.name_ar AS "nameAr",
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(a.geom,
        CASE WHEN a.level <= 2 THEN 0.0005 ELSE 0.0001 END), 5) AS geometry
    FROM geo_areas a
    WHERE a.is_active AND a.level = ANY(${levels})
      AND (${input.cursor ?? ''} = '' OR a.id > ${input.cursor ?? ''})
      AND (NOT ${useBox} OR a.geom && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326))
      AND (${input.districtId ?? ''} = '' OR a.id IN (SELECT id FROM inside))
      AND (${q} = '' OR EXISTS (SELECT 1 FROM unnest(a.aliases) n WHERE n LIKE ${'%' + q + '%'}))
    ORDER BY a.id
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const owners = await areaOwners(
    db,
    page.map((r) => r.id),
  );
  const areas: MapArea[] = page.map((r) => {
    const o = owners.get(r.id);
    return {
      id: r.id,
      level: r.level,
      parentId: r.parentId,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      owner: o
        ? {
            darkStoreId: o.darkStoreId,
            zoneId: o.zoneId,
            excluded: o.darkStoreId === null,
            inherited: o.inherited,
            needsReview: o.needsReview,
          }
        : null,
      geometry: JSON.parse(r.geometry),
    };
  });
  return { areas, nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}

/** Areas the move from drawn outlines left for admin to check (split between stores). */
export async function listAreasToReview(db: Db) {
  return db.$queryRaw<
    {
      areaId: string;
      level: number;
      nameEn: string;
      nameAr: string;
      darkStoreId: string | null;
      zoneId: string | null;
      note: string | null;
    }[]
  >`
    SELECT s.geo_area_id AS "areaId", a.level, a.name_en AS "nameEn", a.name_ar AS "nameAr",
      s.dark_store_id AS "darkStoreId", s.zone_id AS "zoneId", s.note
    FROM store_areas s JOIN geo_areas a ON a.id = s.geo_area_id
    WHERE s.needs_review ORDER BY a.level, a.name_en`;
}

export interface ServedArea {
  id: string;
  level: number;
  nameEn: string;
  nameAr: string;
  parent: { nameEn: string; nameAr: string } | null;
  zoneId: string;
  store: { id: string; code: string; nameEn: string; nameAr: string };
}

/**
 * Neighbourhood search for customers (Arabic and English): the served areas whose names hold
 * the words typed, best match first, at most `limit`. Only areas a store serves now, and only
 * the given stores when `storeIds` is set (a shop's locations).
 */
export async function searchServedAreas(
  db: Db,
  input: { q: string; storeIds?: string[]; limit?: number },
): Promise<ServedArea[]> {
  const q = normalizeAddressText(input.q);
  if (q.length < 2) return [];
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const found = await db.$queryRaw<
    {
      id: string;
      level: number;
      nameEn: string;
      nameAr: string;
      parentEn: string | null;
      parentAr: string | null;
      rank: number;
    }[]
  >`
    SELECT a.id, a.level, a.name_en AS "nameEn", a.name_ar AS "nameAr",
      p.name_en AS "parentEn", p.name_ar AS "parentAr",
      (SELECT min(CASE WHEN n = ${q} THEN 0 WHEN n LIKE ${q + '%'} THEN 1
          WHEN n LIKE ${'% ' + q + '%'} THEN 2 ELSE 3 END)
        FROM unnest(a.aliases) n WHERE n LIKE ${'%' + q + '%'}) AS rank
    FROM geo_areas a LEFT JOIN geo_areas p ON p.id = a.parent_id AND p.level >= 2
    WHERE a.is_active AND a.level BETWEEN 2 AND 4
      AND EXISTS (SELECT 1 FROM unnest(a.aliases) n WHERE n LIKE ${'%' + q + '%'})
    ORDER BY rank, a.level DESC, length(a.name_en), a.id
    LIMIT 300`;
  if (found.length === 0) return [];
  const owners = await areaOwners(
    db,
    found.map((f) => f.id),
  );
  const zoneIds = [...new Set([...owners.values()].map((o) => o.zoneId).filter(Boolean))];
  const zones = await db.zone.findMany({
    where: {
      id: { in: zoneIds as string[] },
      isActive: true,
      darkStore: {
        isActive: true,
        kind: 'dark_store',
        ...(input.storeIds ? { id: { in: input.storeIds } } : {}),
      },
    },
    include: { darkStore: true },
  });
  const byZone = new Map(zones.map((z) => [z.id, z]));
  const out: ServedArea[] = [];
  for (const f of found) {
    const owner = owners.get(f.id);
    const zone = owner?.zoneId ? byZone.get(owner.zoneId) : undefined;
    if (!zone) continue;
    // A district with parts served elsewhere is not one answer; its neighbourhoods are.
    if (await hasOtherOwnersInside(db, f.id, zone.id)) continue;
    out.push({
      id: f.id,
      level: f.level,
      nameEn: f.nameEn,
      nameAr: f.nameAr,
      parent: f.parentEn ? { nameEn: f.parentEn, nameAr: f.parentAr ?? f.parentEn } : null,
      zoneId: zone.id,
      store: {
        id: zone.darkStore.id,
        code: zone.darkStore.code,
        nameEn: zone.darkStore.nameEn,
        nameAr: zone.darkStore.nameAr,
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}
