import type { Prisma, PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit';
import { recomputeZoneArea } from './zone-areas';

// The move from hand drawn zone outlines to assigned areas (docs/ZONES.md section 1), done once
// per database. Neighbourhoods (and compounds) are assigned where the map has them; a database
// with districts only (development, tests) assigns districts instead.

/** An area this much inside the outlines is assigned. */
const ASSIGN_SHARE = 0.6;
/** Another store holding at least this much of an area makes it worth a look. */
const REVIEW_SHARE = 0.05;
const MARKER = 'zones.areas_from_outlines';

export interface OutlineMove {
  done: boolean;
  level: number | null;
  assigned: number;
  review: number;
  zonesKeptOutline: number;
}

interface Share {
  areaId: string;
  level: number;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  zoneId: string;
  storeId: string;
  share: number;
}

/**
 * Assigns areas to the zones whose drawn outline holds at least 60% of them; an area split
 * between stores goes to the store holding the larger part and is marked for review (and listed
 * in one zone_areas_review alert, with the zones that got no area and keep their outline).
 * Runs once: an audit row marks it done. Nothing happens while the map has no districts yet, or
 * when areas were already assigned by hand.
 */
export async function assignAreasFromOutlines(
  db: PrismaClient,
  options: { force?: boolean } = {},
): Promise<OutlineMove> {
  const none = { done: false, level: null, assigned: 0, review: 0, zonesKeptOutline: 0 };
  if (!options.force) {
    if (await db.auditLog.findFirst({ where: { action: MARKER }, select: { id: true } }))
      return none;
  }
  if ((await db.storeArea.count()) > 0) return none;
  const outlined = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM zones z JOIN dark_stores d ON d.id = z.dark_store_id
    WHERE d.kind = 'dark_store' AND COALESCE(z.legacy_area, z.area) IS NOT NULL`;
  if (!outlined[0]?.n) return none;
  const [levels] = await db.$queryRaw<{ l2: number; l3: number }[]>`
    SELECT count(*) FILTER (WHERE level = 2)::int AS l2, count(*) FILTER (WHERE level = 3)::int AS l3
    FROM geo_areas WHERE is_active`;
  if (!levels?.l2) return none;
  const level = levels.l3 > 0 ? 3 : 2;

  return db.$transaction(
    async (tx) => {
      const shares = await tx.$queryRaw<Share[]>`
        SELECT a.id AS "areaId", a.level, a.parent_id AS "parentId", a.name_en AS "nameEn",
          a.name_ar AS "nameAr", z.id AS "zoneId", z.dark_store_id AS "storeId",
          ST_Area(ST_Intersection(COALESCE(z.legacy_area, z.area), a.geom))
            / NULLIF(ST_Area(a.geom), 0) AS share
        FROM geo_areas a
        JOIN zones z ON ST_Intersects(COALESCE(z.legacy_area, z.area), a.geom)
        JOIN dark_stores d ON d.id = z.dark_store_id AND d.kind = 'dark_store'
        WHERE a.is_active AND a.level IN (${level}, ${level === 3 ? 4 : level})
        ORDER BY a.level, a.id`;
      const byArea = new Map<string, Share[]>();
      for (const s of shares) byArea.set(s.areaId, [...(byArea.get(s.areaId) ?? []), s]);

      const decided = new Map<string, string>(); // area -> zone
      const review: {
        areaId: string;
        nameEn: string;
        nameAr: string;
        level: number;
        zoneId: string;
        stores: { storeId: string; share: number }[];
      }[] = [];
      let assigned = 0;
      for (const [areaId, list] of byArea) {
        const total = Math.min(
          1,
          list.reduce((s, x) => s + x.share, 0),
        );
        if (total < ASSIGN_SHARE) continue;
        const best = [...list].sort((a, b) => b.share - a.share)[0]!;
        // A compound follows its neighbourhood unless it lands elsewhere.
        if (best.level === 4 && best.parentId && decided.get(best.parentId) === best.zoneId)
          continue;
        const byStore = new Map<string, number>();
        for (const x of list) byStore.set(x.storeId, (byStore.get(x.storeId) ?? 0) + x.share);
        const split = [...byStore.values()].filter((v) => v >= REVIEW_SHARE).length > 1;
        await tx.storeArea.create({
          data: {
            geoAreaId: areaId,
            darkStoreId: best.storeId,
            zoneId: best.zoneId,
            needsReview: split,
            note: split ? 'split between stores in the drawn outlines' : null,
          },
        });
        decided.set(areaId, best.zoneId);
        assigned++;
        if (split)
          review.push({
            areaId,
            nameEn: best.nameEn,
            nameAr: best.nameAr,
            level: best.level,
            zoneId: best.zoneId,
            stores: [...byStore].map(([storeId, share]) => ({
              storeId,
              share: Math.round(share * 100) / 100,
            })),
          });
      }

      const zones = await tx.zone.findMany({
        where: { darkStore: { kind: 'dark_store' } },
        select: { id: true, code: true, _count: { select: { storeAreas: true } } },
      });
      const kept: { zoneId: string; code: string }[] = [];
      for (const z of zones) {
        if (z._count.storeAreas > 0) await recomputeZoneArea(tx, z.id);
        else kept.push({ zoneId: z.id, code: z.code });
      }
      if (review.length > 0 || kept.length > 0)
        await tx.alert.create({
          data: {
            type: 'zone_areas_review',
            data: {
              level,
              review,
              zonesKeptOutline: kept,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      await recordAudit(tx, {
        actorUserId: null,
        action: MARKER,
        entityType: 'zone',
        entityId: 'all',
        after: { level, assigned, review: review.length, zonesKeptOutline: kept.length },
      });
      return { done: true, level, assigned, review: review.length, zonesKeptOutline: kept.length };
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
}
