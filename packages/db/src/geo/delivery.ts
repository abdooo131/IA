import { normalizeAddressText } from '@shiplynow/shared';
import type { Db } from '../client';
import { type AreaStep, readAddress } from './engine';
import { areaOwners, hasOtherOwnersInside } from './zone-areas';

// One delivery decision for every entry point (docs/ZONES.md section 2):
//
//   map point (pin, Shopify's point, learned from deliveries, saved Google answer)
//     → chosen zone or area (widget, cart attribute, area picker)
//     → live lookup (Google, only when the caller passes one)
//     → the address text through the area engine
//
// The store is the store serving the area; hours and capacity are the caller's to check.
// doorPoint is only ever a real point, never a made up point inside an area.

/** Share of an area that must lie in one zone to call it served by that zone. */
const INSIDE_SHARE = 0.98;
/** Two deliveries of the same address this close agree on where it is. */
const LEARN_RADIUS_M = 150;

export interface DeliveryPoint {
  latitude: number;
  longitude: number;
}

export type PointSource = 'pin' | 'shopify' | 'geocoder' | 'learned' | 'cache';

export interface ResolveDeliveryInput {
  point?: (DeliveryPoint & { source?: PointSource }) | null;
  /** A zone picked by the customer (old widget, `_shiplynow_zone`) */
  zoneId?: string | null;
  /** A neighbourhood or other area picked by the customer (`_shiplynow_area`, area picker) */
  areaId?: string | null;
  addressText?: string | null;
  city?: string | null;
  governorate?: string | null;
  /**
   * A paid lookup asked after a chosen area and before the area engine; only passed when it is
   * configured. It may throw: the decision then goes on without it.
   */
  geocode?: (text: string) => Promise<DeliveryPoint | null>;
}

interface StoreRef {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
type ZoneRef = StoreRef;

export interface DeliveryDecision {
  status: 'served' | 'outside' | 'unsure';
  store: StoreRef | null;
  zone: ZoneRef | null;
  /** The area found (from the point or the text), served or not */
  area: AreaStep | null;
  /** What decided: a map point, a learned point, the customer's choice, or the address text */
  confidence: 'point' | 'learned' | 'chosen' | 'text' | null;
  /** A real point for the rider, when there is one */
  doorPoint: DeliveryPoint | null;
  pointSource: PointSource | null;
  reason: string;
  /** Other stores whose zones also hold the point (old overlapping outlines), nearest first */
  alternatives: { store: StoreRef; zone: ZoneRef; distanceMeters: number }[];
  /** The area and everything above it, governorate first, when the text was read */
  chain: AreaStep[];
}

/** The key addresses are saved and learned under. */
export function addressKey(text: string) {
  return normalizeAddressText(text);
}

/** The key of the saved Google answers (geocode_cache), as AddressLocator always wrote it. */
export function geocodeKey(text: string) {
  return `${text.trim()}, EG`.toLowerCase().replace(/\s+/g, ' ');
}

/** The address with its city and governorate, each part once. */
export function fullAddress(input: {
  addressText?: string | null;
  city?: string | null;
  governorate?: string | null;
}) {
  const parts: string[] = [];
  for (const p of [input.addressText, input.city, input.governorate]) {
    const t = (p ?? '').trim();
    if (!t) continue;
    const joined = normalizeAddressText(parts.join(' '));
    if (parts.length && ` ${joined} `.includes(` ${normalizeAddressText(t)} `)) continue;
    parts.push(t);
  }
  return parts.join(', ');
}

const base = (): Omit<DeliveryDecision, 'status' | 'reason'> => ({
  store: null,
  zone: null,
  area: null,
  confidence: null,
  doorPoint: null,
  pointSource: null,
  alternatives: [],
  chain: [],
});

/** Metres between two points (haversine). */
export function metresBetween(a: DeliveryPoint, b: DeliveryPoint) {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * The trusted point learned from deliveries of this address: at least two delivered positions
 * within 150 m of each other; their middle. Null until then.
 */
export async function learnedPoint(db: Db, text: string): Promise<DeliveryPoint | null> {
  const key = addressKey(text);
  if (!key) return null;
  const points = await db.deliveredPoint.findMany({
    where: { addressKey: key },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { latitude: true, longitude: true },
  });
  let best: DeliveryPoint[] = [];
  for (const p of points) {
    const near = points.filter((o) => metresBetween(p, o) <= LEARN_RADIUS_M);
    if (near.length >= 2 && near.length > best.length) best = near;
  }
  if (best.length < 2) return null;
  return {
    latitude: best.reduce((s, p) => s + p.latitude, 0) / best.length,
    longitude: best.reduce((s, p) => s + p.longitude, 0) / best.length,
  };
}

/** Keeps where the rider stood when the order was delivered, under its address text. */
export async function recordDeliveredPoint(
  db: Db,
  input: { orderId: string; addressText: string; point: DeliveryPoint },
) {
  const key = addressKey(input.addressText);
  if (!key) return;
  await db.deliveredPoint.upsert({
    where: { orderId: input.orderId },
    create: {
      orderId: input.orderId,
      addressKey: key,
      latitude: input.point.latitude,
      longitude: input.point.longitude,
    },
    update: {},
  });
}

/** A saved Google answer for this text (never the made up points the engine used to save). */
async function cachedPoint(db: Db, text: string): Promise<DeliveryPoint | null> {
  const row = await db.geocodeCache.findUnique({ where: { addressKey: geocodeKey(text) } });
  if (!row || row.latitude == null || row.longitude == null) return null;
  if (row.method === 'engine') return null;
  return { latitude: row.latitude, longitude: row.longitude };
}

async function decideByPoint(
  db: Db,
  point: DeliveryPoint,
  source: PointSource,
  confidence: 'point' | 'learned',
): Promise<DeliveryDecision> {
  const zones = await db.$queryRaw<
    {
      zoneId: string;
      zoneCode: string;
      zoneEn: string;
      zoneAr: string;
      storeId: string;
      storeCode: string;
      storeEn: string;
      storeAr: string;
      distanceMeters: number;
    }[]
  >`
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326) AS g)
    SELECT z.id AS "zoneId", z.code AS "zoneCode", z.name_en AS "zoneEn", z.name_ar AS "zoneAr",
      d.id AS "storeId", d.code AS "storeCode", d.name_en AS "storeEn", d.name_ar AS "storeAr",
      ST_Distance(ST_SetSRID(ST_MakePoint(d.longitude, d.latitude), 4326)::geography,
        p.g::geography) AS "distanceMeters"
    FROM zones z JOIN dark_stores d ON d.id = z.dark_store_id, p
    WHERE z.is_active AND d.is_active AND d.kind = 'dark_store' AND z.area IS NOT NULL
      AND ST_Contains(z.area, p.g)
    ORDER BY "distanceMeters", z.code`;
  const [area] = await db.$queryRaw<AreaStep[]>`
    SELECT id, level, name_en AS "nameEn", name_ar AS "nameAr" FROM geo_areas
    WHERE is_active AND level <= 4
      AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326))
    ORDER BY level DESC, ST_Area(geom) ASC LIMIT 1`;
  const common = {
    ...base(),
    area: area ?? null,
    confidence,
    doorPoint: point,
    pointSource: source,
  };
  const ref = (z: (typeof zones)[number]) => ({
    store: { id: z.storeId, code: z.storeCode, nameEn: z.storeEn, nameAr: z.storeAr },
    zone: { id: z.zoneId, code: z.zoneCode, nameEn: z.zoneEn, nameAr: z.zoneAr },
  });
  const first = zones[0];
  if (!first) return { ...common, status: 'outside', reason: 'point_outside_zones' };
  return {
    ...common,
    ...ref(first),
    status: 'served',
    reason: confidence === 'learned' ? 'learned_point' : 'point_in_zone',
    alternatives: zones
      .slice(1)
      .filter((z) => z.storeId !== first.storeId)
      .map((z) => ({ ...ref(z), distanceMeters: z.distanceMeters })),
  };
}

async function liveZone(db: Db, zoneId: string) {
  const zone = await db.zone.findFirst({
    where: { id: zoneId, isActive: true, darkStore: { isActive: true, kind: 'dark_store' } },
    include: { darkStore: true },
  });
  if (!zone) return null;
  return {
    zone: { id: zone.id, code: zone.code, nameEn: zone.nameEn, nameAr: zone.nameAr },
    store: {
      id: zone.darkStore.id,
      code: zone.darkStore.code,
      nameEn: zone.darkStore.nameEn,
      nameAr: zone.darkStore.nameAr,
    },
  };
}

type AreaAnswer =
  | { status: 'served'; zoneId: string; reason: string }
  | { status: 'outside'; reason: string }
  | { status: 'unsure'; reason: string };

/** Who serves one area: its own row or an area above it, else the zones' shapes. */
async function serveArea(db: Db, area: AreaStep): Promise<AreaAnswer> {
  const owner = (await areaOwners(db, [area.id])).get(area.id);
  if (owner) {
    if (!owner.zoneId) return { status: 'outside', reason: 'area_not_served' };
    if (!(await liveZone(db, owner.zoneId))) return { status: 'outside', reason: 'zone_closed' };
    if (!(await hasOtherOwnersInside(db, area.id, owner.zoneId)))
      return { status: 'served', zoneId: owner.zoneId, reason: 'area_served' };
    // Parts of it are served elsewhere (or not at all): only its shape can still say.
  }
  const overlap = await db.$queryRaw<{ zoneId: string; share: number }[]>`
    SELECT z.id AS "zoneId",
      ST_Area(ST_Intersection(z.area, a.geom)) / NULLIF(ST_Area(a.geom), 0) AS share
    FROM zones z
    JOIN dark_stores s ON s.id = z.dark_store_id AND s.is_active AND s.kind = 'dark_store'
    JOIN geo_areas a ON a.id = ${area.id}
    WHERE z.is_active AND z.area IS NOT NULL AND ST_Intersects(z.area, a.geom)
    ORDER BY share DESC`;
  const inside = overlap[0];
  if (inside && inside.share >= INSIDE_SHARE)
    return { status: 'served', zoneId: inside.zoneId, reason: 'area_in_zone' };
  if (overlap.length === 0 || (inside && inside.share < 0.001)) {
    return area.level >= 2
      ? { status: 'outside', reason: 'area_outside_zones' }
      : { status: 'unsure', reason: 'too_coarse' };
  }
  return { status: 'unsure', reason: 'area_spans_zones' };
}

async function decideByArea(
  db: Db,
  areas: AreaStep[],
  confidence: 'chosen' | 'text',
  chain: AreaStep[],
): Promise<DeliveryDecision> {
  const answers = await Promise.all(areas.map((a) => serveArea(db, a)));
  const first = answers[0]!;
  const same = answers.every(
    (a) =>
      a.status === first.status &&
      (a.status !== 'served' || (first.status === 'served' && a.zoneId === first.zoneId)),
  );
  const common = { ...base(), area: areas[0]!, chain, confidence };
  if (!same) return { ...common, status: 'unsure', reason: 'stores_tie' };
  if (first.status !== 'served') return { ...common, status: first.status, reason: first.reason };
  const live = (await liveZone(db, first.zoneId))!;
  return { ...common, ...live, status: 'served', reason: first.reason };
}

async function areaStep(db: Db, areaId: string): Promise<AreaStep | null> {
  const area = await db.geoArea.findFirst({
    where: { id: areaId, isActive: true },
    select: { id: true, level: true, nameEn: true, nameAr: true },
  });
  return area;
}

/** The one delivery decision (docs/ZONES.md section 2). */
export async function resolveDelivery(
  db: Db,
  input: ResolveDeliveryInput,
): Promise<DeliveryDecision> {
  // 1. A real point: the customer's pin, Shopify's point, or a geocoder answer from the caller.
  if (input.point) return decideByPoint(db, input.point, input.point.source ?? 'pin', 'point');

  const text = fullAddress(input);
  // 2. Where this address was delivered before, then a saved Google answer.
  if (text) {
    const learned = await learnedPoint(db, text);
    if (learned) return decideByPoint(db, learned, 'learned', 'learned');
    const cached = await cachedPoint(db, text);
    if (cached) return decideByPoint(db, cached, 'cache', 'point');
  }

  // 3. What the customer chose.
  if (input.zoneId) {
    const live = await liveZone(db, input.zoneId);
    if (live)
      return { ...base(), ...live, status: 'served', confidence: 'chosen', reason: 'chosen_zone' };
  }
  if (input.areaId) {
    const area = await areaStep(db, input.areaId);
    if (area) return decideByArea(db, [area], 'chosen', [area]);
  }

  // 4. A paid lookup, when configured.
  let geocoderFailed = false;
  if (text && input.geocode) {
    try {
      const found = await input.geocode(text);
      if (found) return decideByPoint(db, found, 'geocoder', 'point');
    } catch {
      geocoderFailed = true;
    }
  }

  // 5. The address text.
  if (!text) return { ...base(), status: 'unsure', reason: 'nothing_given' };
  const reading = await readAddress(db, text);
  if (reading.status === 'outside')
    return { ...base(), chain: reading.chain, status: 'outside', reason: reading.reason };
  if (reading.status === 'unsure')
    return {
      ...base(),
      chain: reading.chain,
      status: 'unsure',
      reason: geocoderFailed ? 'geocoder_failed' : reading.reason,
    };
  const decision = await decideByArea(db, reading.areas, 'text', reading.chain);
  if (decision.status === 'unsure' && geocoderFailed) decision.reason = 'geocoder_failed';
  return decision;
}
