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
