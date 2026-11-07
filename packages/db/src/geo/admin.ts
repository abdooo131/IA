import { normalizeAddressText } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { forgetAreaNames } from './engine';

/** Adds a name (any language or spelling) to an area so the engine recognises it. */
export function addAreaName(db: Db, input: { areaId: string; name: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const name = normalizeAddressText(input.name);
    if (name.length < 2) throw new DomainError('name_too_short', 400);
    const area = await tx.geoArea.findUnique({ where: { id: input.areaId } });
    if (!area) throw new DomainError('area_not_found', 404);
    if (!area.aliases.includes(name))
      await tx.geoArea.update({
        where: { id: area.id },
        data: { aliases: [...area.aliases, name] },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'geo_area.add_name',
      entityType: 'geo_area',
      entityId: area.id,
      after: { name },
    });
    forgetAreaNames();
    return { name };
  });
}

/** Admin accepts a suggestion, optionally correcting the words, as a name of its area. */
export function decideSuggestion(
  db: Db,
  input: { suggestionId: string; approve: boolean; phrase?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const s = await tx.geoSuggestion.findUnique({ where: { id: input.suggestionId } });
    if (!s) throw new DomainError('suggestion_not_found', 404);
    if (s.status !== 'pending') throw new DomainError('suggestion_decided');
    let name: string | null = null;
    if (input.approve) {
      ({ name } = await addAreaName(tx, {
        areaId: s.areaId,
        name: input.phrase ?? s.phrase,
        actorUserId: input.actorUserId,
      }));
    }
    await tx.geoSuggestion.update({
      where: { id: s.id },
      data: {
        status: input.approve ? 'approved' : 'rejected',
        decidedById: input.actorUserId,
        decidedAt: new Date(),
      },
    });
    return { status: input.approve ? 'approved' : 'rejected', name };
  });
}

export async function listSuggestions(db: Db) {
  const rows = await db.geoSuggestion.findMany({
    where: { status: 'pending' },
    include: { area: { select: { id: true, level: true, nameEn: true, nameAr: true } } },
    orderBy: [{ seen: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });
  return rows.map((s) => ({
    id: s.id,
    phrase: s.phrase,
    sampleAddress: s.sampleAddress,
    seen: s.seen,
    area: s.area,
    updatedAt: s.updatedAt.toISOString(),
  }));
}

/** Areas whose names contain the search words, smallest first, for adding a name by hand. */
export async function searchAreas(db: Db, query: string) {
  const q = normalizeAddressText(query);
  if (q.length < 2) return [];
  const rows = await db.$queryRaw<
    {
      id: string;
      level: number;
      nameEn: string;
      nameAr: string;
      parentEn: string | null;
      aliases: string[];
    }[]
  >`
    SELECT a.id, a.level, a.name_en AS "nameEn", a.name_ar AS "nameAr", p.name_en AS "parentEn", a.aliases
    FROM geo_areas a LEFT JOIN geo_areas p ON p.id = a.parent_id
    WHERE a.is_active AND EXISTS (SELECT 1 FROM unnest(a.aliases) n WHERE n LIKE ${'%' + q + '%'})
    ORDER BY a.level ASC, a.name_en ASC
    LIMIT 50`;
  return rows;
}

/** How addresses were placed in the last 30 days, and how big the area map is. */
export async function geoStats(db: Db, now: Date = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const [byLevel, byMethod, pending] = await Promise.all([
    db.geoArea.groupBy({ by: ['level'], where: { isActive: true }, _count: { _all: true } }),
    db.geocodeCache.groupBy({
      by: ['method'],
      where: { createdAt: { gte: since }, latitude: { not: null } },
      _count: { _all: true },
    }),
    db.geoSuggestion.count({ where: { status: 'pending' } }),
  ]);
  return {
    areasByLevel: Object.fromEntries(byLevel.map((r) => [r.level, r._count._all])),
    placedByMethod: Object.fromEntries(byMethod.map((r) => [r.method ?? 'unknown', r._count._all])),
    pendingSuggestions: pending,
  };
}
