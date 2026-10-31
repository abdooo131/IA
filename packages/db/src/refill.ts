import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { getSetting } from './settings';
import { createTransfer } from './transfers';

// Automatic refill (agreed with the business): every store has a minimum and a maximum per
// product (its own row in stock_targets, else the store's default settings). Once a day the
// planner looks at what each store has plus what is already coming, and for every product below
// its minimum prepares refills up to the maximum: first from the hub's free shelf stock, then
// from stores holding more than their maximum (those go through the hub like any store to store
// transfer). It only prepares drafts, one per trip; admin approves them. A day is planned once.
//
//   store below min ──hub has free──▶ draft hub → store
//                   └─hub short─────▶ draft donor store → (hub) → store, only donor's excess

const COMING: ('draft' | 'approved' | 'picking' | 'in_transit')[] = [
  'draft',
  'approved',
  'picking',
  'in_transit',
];

interface Plan {
  fromId: string;
  toId: string;
  lines: Map<string, number>;
}

/** Each store's min and max for each product, with the store default where no row exists. */
async function targetsFor(db: Db, storeIds: string[], skuIds: string[]) {
  const rows = await db.stockTarget.findMany({
    where: { darkStoreId: { in: storeIds }, skuId: { in: skuIds } },
  });
  const defaults = new Map<string, { min: number; max: number }>();
  for (const id of storeIds)
    defaults.set(id, {
      min: await getSetting(db, 'refill.default_min_units', id),
      max: await getSetting(db, 'refill.default_max_units', id),
    });
  return (storeId: string, skuId: string) => {
    const row = rows.find((r) => r.darkStoreId === storeId && r.skuId === skuId);
    return row ? { min: row.minUnits, max: row.maxUnits } : defaults.get(storeId)!;
  };
}

/**
 * Prepares the refill drafts for one Cairo day. Running it again the same day changes nothing.
 * Returns the drafts made (empty when there is no hub, it is switched off, or nothing is low).
 */
export function planRefill(db: Db, input: { day: string; actorUserId?: string | null }) {
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refill_plan'))`;
    if (await tx.transfer.findFirst({ where: { origin: 'refill', refillDay: input.day } }))
      return { day: input.day, created: [], alreadyPlanned: true };
    if ((await getSetting(tx, 'refill.enabled')) === 0)
      return { day: input.day, created: [], alreadyPlanned: false };

    const hub = await tx.darkStore.findFirst({
      where: { kind: 'hub', isActive: true },
      orderBy: { code: 'asc' },
    });
    if (!hub) return { day: input.day, created: [], alreadyPlanned: false };
    const stores = await tx.darkStore.findMany({
      where: { kind: 'dark_store', isActive: true },
      orderBy: { code: 'asc' },
    });
    const storeIds = stores.map((s) => s.id);

    const [levels, open] = await Promise.all([
      tx.stockLevel.findMany({ where: { darkStoreId: { in: [hub.id, ...storeIds] } } }),
      tx.transfer.findMany({ where: { status: { in: COMING } }, include: { lines: true } }),
    ]);
    const skuIds = [...new Set(levels.map((l) => l.skuId))];
    const target = await targetsFor(tx, storeIds, skuIds);

    const free = (locationId: string, skuId: string) => {
      const l = levels.find((x) => x.darkStoreId === locationId && x.skuId === skuId);
      // Drafts are not held yet, so what they will take is subtracted here.
      const drafted = open
        .filter((t) => t.status === 'draft' && t.fromId === locationId)
        .flatMap((t) => t.lines)
        .filter((x) => x.skuId === skuId)
        .reduce((s, x) => s + x.quantity, 0);
      return Math.max(0, (l ? l.onHand - l.reserved : 0) - drafted);
    };
    /** Units already heading to a store, directly or through the hub. */
    const coming = (storeId: string, skuId: string) =>
      open
        .filter((t) => t.toId === storeId || t.finalDestinationId === storeId)
        .flatMap((t) => t.lines.map((l) => ({ l, sent: t.status === 'in_transit' })))
        .filter(({ l }) => l.skuId === skuId)
        .reduce((s, { l, sent }) => s + (sent ? l.pickedQty - l.receivedQty : l.quantity), 0);
    const have = (storeId: string, skuId: string) => {
      const l = levels.find((x) => x.darkStoreId === storeId && x.skuId === skuId);
      return (l ? l.onHand - l.reserved : 0) + coming(storeId, skuId);
    };

    const plans = new Map<string, Plan>();
    const add = (fromId: string, toId: string, skuId: string, quantity: number) => {
      const key = `${fromId}>${toId}`;
      const plan = plans.get(key) ?? { fromId, toId, lines: new Map() };
      plan.lines.set(skuId, (plan.lines.get(skuId) ?? 0) + quantity);
      plans.set(key, plan);
    };

    for (const skuId of skuIds) {
      let hubFree = free(hub.id, skuId);
      // Neediest store first, so a short hub serves the emptiest shelves.
      const needs = stores
        .map((s) => {
          const { min, max } = target(s.id, skuId);
          const h = have(s.id, skuId);
          return { store: s, need: h < min ? max - h : 0 };
        })
        .filter((n) => n.need > 0)
        .sort((a, b) => b.need - a.need);
      if (needs.length === 0) continue;
      // Stores holding more than their maximum can give the excess.
      const donors = stores
        .map((s) => {
          const { max } = target(s.id, skuId);
          return { store: s, spare: Math.min(free(s.id, skuId), have(s.id, skuId) - max) };
        })
        .filter((d) => d.spare > 0);

      for (const n of needs) {
        let need = n.need;
        const fromHub = Math.min(need, hubFree);
        if (fromHub > 0) {
          add(hub.id, n.store.id, skuId, fromHub);
          hubFree -= fromHub;
          need -= fromHub;
        }
        for (const d of donors) {
          if (need === 0) break;
          if (d.store.id === n.store.id || d.spare === 0) continue;
          const give = Math.min(need, d.spare);
          add(d.store.id, n.store.id, skuId, give);
          d.spare -= give;
          need -= give;
        }
      }
    }

    const created: { id: string; reference: string }[] = [];
    for (const plan of plans.values()) {
      const t = await createTransfer(tx, {
        fromId: plan.fromId,
        toId: plan.toId,
        lines: [...plan.lines].map(([skuId, quantity]) => ({ skuId, quantity })),
        draft: true,
        origin: 'refill',
        refillDay: input.day,
        actorUserId: input.actorUserId ?? null,
      });
      created.push({ id: t.id, reference: t.reference });
    }
    if (created.length > 0)
      await recordAudit(tx, {
        actorUserId: input.actorUserId ?? null,
        action: 'refill.plan',
        entityType: 'refill',
        entityId: input.day,
        after: { drafts: created.map((c) => c.reference) },
      });
    return { day: input.day, created, alreadyPlanned: false };
  });
}

/** Sets a store's own refill levels for one product; both null removes them (defaults apply). */
export function setStockTarget(
  db: Db,
  input: {
    darkStoreId: string;
    skuId: string;
    minUnits: number | null;
    maxUnits: number | null;
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const where = { darkStoreId_skuId: { darkStoreId: input.darkStoreId, skuId: input.skuId } };
    const before = await tx.stockTarget.findUnique({ where });
    if (input.minUnits === null || input.maxUnits === null) {
      if (before) await tx.stockTarget.delete({ where });
    } else {
      if (input.minUnits > input.maxUnits) throw new DomainError('min_above_max', 400);
      await tx.stockTarget.upsert({
        where,
        create: {
          darkStoreId: input.darkStoreId,
          skuId: input.skuId,
          minUnits: input.minUnits,
          maxUnits: input.maxUnits,
        },
        update: { minUnits: input.minUnits, maxUnits: input.maxUnits },
      });
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'stock_target.set',
      entityType: 'stock_target',
      entityId: `${input.darkStoreId}:${input.skuId}`,
      before: before ? { min: before.minUnits, max: before.maxUnits } : null,
      after: input.minUnits === null ? null : { min: input.minUnits, max: input.maxUnits },
    });
    return { minUnits: input.minUnits, maxUnits: input.maxUnits };
  });
}

/** Every store's levels and current stock for each product, for the admin refill page. */
export async function refillOverview(db: Db) {
  const stores = await db.darkStore.findMany({
    where: { kind: 'dark_store', isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nameEn: true, nameAr: true },
  });
  const hub = await db.darkStore.findFirst({ where: { kind: 'hub', isActive: true } });
  const [skus, levels, rows] = await Promise.all([
    db.sku.findMany({
      where: { isActive: true },
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, titleEn: true, titleAr: true },
    }),
    db.stockLevel.findMany(),
    db.stockTarget.findMany(),
  ]);
  const defaults = await Promise.all(
    stores.map(async (s) => ({
      storeId: s.id,
      min: await getSetting(db, 'refill.default_min_units', s.id),
      max: await getSetting(db, 'refill.default_max_units', s.id),
    })),
  );
  const onHand = (storeId: string, skuId: string) =>
    levels.find((l) => l.darkStoreId === storeId && l.skuId === skuId)?.onHand ?? 0;
  return {
    stores,
    hub: hub ? { id: hub.id, code: hub.code, nameEn: hub.nameEn, nameAr: hub.nameAr } : null,
    defaults,
    rows: skus.map((sku) => ({
      ...sku,
      hubOnHand: hub ? onHand(hub.id, sku.id) : 0,
      stores: stores.map((s) => {
        const own = rows.find((r) => r.darkStoreId === s.id && r.skuId === sku.id);
        return {
          storeId: s.id,
          onHand: onHand(s.id, sku.id),
          min: own?.minUnits ?? null,
          max: own?.maxUnits ?? null,
        };
      }),
    })),
  };
}
