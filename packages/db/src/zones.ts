import type { Db } from './client';

/** A GeoJSON Polygon or MultiPolygon, coordinates as [longitude, latitude] in WGS84. */
export interface ZoneGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

/** Sets a zone's area. Polygons are stored as MultiPolygon; invalid shapes are refused. */
export async function setZoneArea(db: Db, zoneId: string, geometry: ZoneGeometry) {
  const json = JSON.stringify(geometry);
  const [check] = await db.$queryRaw<{ valid: boolean }[]>`
    SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)) AS valid`;
  if (!check?.valid) throw new Error('zone_geometry_invalid');
  await db.$executeRaw`
    UPDATE zones SET area = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)), updated_at = now()
    WHERE id = ${zoneId}`;
}

/** Active zones whose area contains the point. Coverage rules (hours, capacity) come in Step 3. */
export function zonesContaining(db: Db, point: { latitude: number; longitude: number }) {
  return db.$queryRaw<{ id: string; code: string; darkStoreId: string }[]>`
    SELECT id, code, dark_store_id AS "darkStoreId" FROM zones
    WHERE is_active AND area IS NOT NULL
      AND ST_Contains(area, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))`;
}

export interface CoveringZone {
  zoneId: string;
  zoneCode: string;
  zoneNameEn: string;
  zoneNameAr: string;
  darkStoreId: string;
  darkStoreCode: string;
  darkStoreNameEn: string;
  darkStoreNameAr: string;
  /** Metres from the point to the dark store */
  distanceMeters: number;
}

/** Active zones of active stores containing the point, nearest store first. */
export function coveringZones(db: Db, point: { latitude: number; longitude: number }) {
  return db.$queryRaw<CoveringZone[]>`
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326) AS geom)
    SELECT z.id AS "zoneId", z.code AS "zoneCode", z.name_en AS "zoneNameEn", z.name_ar AS "zoneNameAr",
           d.id AS "darkStoreId", d.code AS "darkStoreCode", d.name_en AS "darkStoreNameEn",
           d.name_ar AS "darkStoreNameAr",
           ST_Distance(ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326)::geography,
                       p.geom::geography) AS "distanceMeters"
    FROM zones z JOIN dark_stores d ON d.id = z.dark_store_id, p
    WHERE z.is_active AND d.is_active AND z.area IS NOT NULL AND ST_Contains(z.area, p.geom)
    ORDER BY "distanceMeters", z.code`;
}

export interface ZoneWithArea {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  darkStoreId: string;
  /** GeoJSON MultiPolygon, or null when no area was drawn yet */
  area: { type: 'MultiPolygon'; coordinates: number[][][][] } | null;
  /** [longitude, latitude] of a point inside the zone, for labels */
  center: [number, number] | null;
}

/** Every zone with its area as GeoJSON. */
export async function listZonesWithArea(db: Db, options: { activeOnly?: boolean } = {}) {
  const rows = await db.$queryRaw<
    (Omit<ZoneWithArea, 'area' | 'center'> & { area: string | null; center: string | null })[]
  >`
    SELECT z.id, z.code, z.name_en AS "nameEn", z.name_ar AS "nameAr", z.is_active AS "isActive",
           z.dark_store_id AS "darkStoreId", ST_AsGeoJSON(z.area, 6) AS area,
           ST_AsGeoJSON(ST_PointOnSurface(z.area), 6) AS center
    FROM zones z JOIN dark_stores d ON d.id = z.dark_store_id
    WHERE ${options.activeOnly ?? false} = false OR (z.is_active AND d.is_active)
    ORDER BY d.code, z.code`;
  return rows.map((r) => ({
    ...r,
    area: r.area ? JSON.parse(r.area) : null,
    center: r.center ? (JSON.parse(r.center).coordinates as [number, number]) : null,
  })) as ZoneWithArea[];
}
