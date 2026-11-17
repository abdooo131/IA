import type { LocationKind } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';

/** Opening hours a new location starts with: every day 10:00 to midnight. Admin edits them. */
const DEFAULT_HOURS = { opensMinute: 10 * 60, closesMinute: 24 * 60 };

const shelfCode = (n: number) => `A-${String(n).padStart(2, '0')}`;

export interface CreateLocationInput {
  kind: LocationKind;
  code: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  governorateId: number;
  latitude: number;
  longitude: number;
  /** Number of shelf bins (A-01, A-02, ...) to create */
  shelves: number;
  actorUserId: string | null;
}

/**
 * Opens a dark store or a hub with everything it needs to work: opening hours and one
 * receiving, damaged and held bin plus the shelves. Zones are drawn afterwards (stores only).
 */
export function createLocation(db: Db, input: CreateLocationInput) {
  return inTransaction(db, async (tx) => {
    const code = input.code.trim().toUpperCase();
    if (await tx.darkStore.findUnique({ where: { code } })) throw new DomainError('code_taken');
    const governorate = await tx.governorate.findUnique({ where: { id: input.governorateId } });
    if (!governorate) throw new DomainError('governorate_not_found', 400);
    const store = await tx.darkStore.create({
      data: {
        kind: input.kind,
        code,
        nameEn: input.nameEn.trim(),
        nameAr: input.nameAr.trim(),
        addressEn: input.addressEn.trim(),
        addressAr: input.addressAr.trim(),
        governorateId: input.governorateId,
        latitude: input.latitude,
        longitude: input.longitude,
        hours: {
          create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, ...DEFAULT_HOURS })),
        },
        bins: {
          create: [
            { code: 'RCV-01', type: 'receiving' as const },
            { code: 'DMG-01', type: 'damaged' as const },
            { code: 'HLD-01', type: 'held' as const },
            ...Array.from({ length: input.shelves }, (_, i) => ({
              code: shelfCode(i + 1),
              type: 'pickable' as const,
            })),
          ],
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'dark_store.create',
      entityType: 'dark_store',
      entityId: store.id,
      after: { kind: store.kind, code, nameEn: store.nameEn, shelves: input.shelves },
    });
    return store;
  });
}

/** Adds shelf bins after the highest A-nn the location already has. */
export function addShelves(
  db: Db,
  input: { darkStoreId: string; count: number; actorUserId: string | null },
) {
  return inTransaction(db, async (tx) => {
    const store = await tx.darkStore.findUnique({ where: { id: input.darkStoreId } });
    if (!store) throw new DomainError('dark_store_not_found', 404);
    const shelves = await tx.bin.findMany({
      where: { darkStoreId: store.id, code: { startsWith: 'A-' } },
      select: { code: true },
    });
    const highest = Math.max(0, ...shelves.map((b) => Number(b.code.slice(2)) || 0));
    const codes = Array.from({ length: input.count }, (_, i) => shelfCode(highest + i + 1));
    await tx.bin.createMany({
      data: codes.map((code) => ({ darkStoreId: store.id, code, type: 'pickable' as const })),
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'dark_store.add_shelves',
      entityType: 'dark_store',
      entityId: store.id,
      after: { added: codes },
    });
    return { added: codes };
  });
}

/** The hubs, if any. Merchant shipments go to a hub once one exists. */
export function listHubs(db: Db) {
  return db.darkStore.findMany({
    where: { kind: 'hub', isActive: true },
    orderBy: { code: 'asc' },
  });
}
