import { z } from 'zod';

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);

/** GET /coverage takes a point (a map pin), a chosen area (geo_areas id) or an address. */
export const coverageQuerySchema = z.union([
  z.object({ lat: latitude, lng: longitude }),
  z.object({ areaId: z.string().trim().min(1).max(64) }),
  z.object({ address: z.string().trim().min(3).max(300) }),
]);
export type CoverageQuery = z.infer<typeof coverageQuerySchema>;

/**
 * Why an address gets no 60 minute delivery. address_unsure: the address could not be placed
 * with confidence (ask for the area or a map pin).
 */
export const COVERAGE_REASONS = [
  'outside_zones',
  'address_unsure',
  'store_closed',
  'at_capacity',
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

export const weekHoursSchema = z
  .array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        opensMinute: z.number().int().min(0).max(1439),
        closesMinute: z.number().int().min(1).max(2880),
        isClosed: z.boolean(),
      })
      .refine((d) => d.closesMinute > d.opensMinute, { message: 'closes_before_opens' })
      .refine((d) => d.closesMinute - d.opensMinute <= 1440, { message: 'longer_than_a_day' }),
  )
  .length(7)
  .refine((days) => new Set(days.map((d) => d.weekday)).size === 7, {
    message: 'duplicate_weekday',
  });
export type WeekHours = z.infer<typeof weekHoursSchema>;

/** Rough box around Egypt; zones outside it are almost certainly a mistake. */
const EGYPT = { minLng: 24.5, maxLng: 37.5, minLat: 21.5, maxLat: 32 };

const position = z
  .tuple([z.number(), z.number()])
  .refine(
    ([lng, lat]) =>
      lng >= EGYPT.minLng && lng <= EGYPT.maxLng && lat >= EGYPT.minLat && lat <= EGYPT.maxLat,
    {
      message: 'outside_egypt',
    },
  );

const ring = z
  .array(position)
  .min(4)
  .max(500)
  .refine((r) => r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1], {
    message: 'ring_not_closed',
  });

/** A single GeoJSON Polygon, coordinates as [longitude, latitude]. */
export const zonePolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(ring).min(1).max(10),
});
export type ZonePolygon = z.infer<typeof zonePolygonSchema>;

export const createZoneSchema = z.object({
  darkStoreId: z.string().min(1),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  /**
   * Optional: "select the areas inside this shape". Zones are built from areas
   * (docs/ZONES.md); without it the zone starts empty and areas are assigned on the map.
   */
  area: zonePolygonSchema.optional(),
});
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

export const capacitySchema = z.object({ value: z.number().int().min(0).max(100_000) });

/** A map point the customer dropped (or a phone position), as sent by the apps. */
export const mapPointSchema = z.object({ latitude, longitude });
export type MapPoint = z.infer<typeof mapPointSchema>;

/**
 * Reads the `_shiplynow_pin` cart attribute ("30.0123,31.4567"); null when it is not a point
 * inside Egypt's rough box.
 */
export function parsePinAttribute(value: string | null | undefined): MapPoint | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value ?? '');
  if (!m) return null;
  const point = { latitude: Number(m[1]), longitude: Number(m[2]) };
  const inEgypt =
    point.latitude >= 21.5 &&
    point.latitude <= 32 &&
    point.longitude >= 24.5 &&
    point.longitude <= 37.5;
  return inEgypt ? point : null;
}

/** Assigning one area to a zone from the zone map. */
export const assignAreaSchema = z.object({
  areaId: z.string().trim().min(1).max(64),
  /** Take it from the store serving it now */
  move: z.boolean().optional(),
});

/** "Select the areas inside this shape" for a zone. */
export const selectAreasSchema = z.object({
  shape: zonePolygonSchema,
  /** 2 districts, 3 neighbourhoods (default), 4 compounds */
  level: z.number().int().min(2).max(4).default(3),
  /** Share of an area that must lie inside the shape, 0.6 by default */
  minShare: z.number().min(0.1).max(1).optional(),
  move: z.boolean().optional(),
});
