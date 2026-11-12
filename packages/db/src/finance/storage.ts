import { addDays, cairoDayStart } from '@shiplynow/shared';
import type { Db } from '../client';
import { getSetting } from '../settings';
import { accrueStorage, lastClosedDay } from './postings';

// Units in stock per store, merchant and Cairo day, and the daily storage charge with catch up.
//
// stock_unit_days holds, for every store and merchant (whether or not they pay storage), the
// units they had at the end of a Cairo day in every bin (sellable or not). The storage job
// writes it each day before charging, and merchant profit shares each store's rent by these
// unit days, so merchants on all inclusive contracts (storage at 0, no storage entries) carry
// their part of the rent too.
//
// The units of a past day are worked out exactly from the stock itself: stock only changes
// through stock_movements (append only, each with its bins), so the units at the end of day D
// are the units held now minus what every movement after D added (to a bin) or took (from a
// bin). That is why a run that comes late (the server slept) still charges the day's own
// units rather than today's, and why merchant profit can fill days before the snapshot
// existed. A pair that would come out below zero (only possible if bin_stock was edited
// outside a movement) counts 0.

export interface UnitsRow {
  darkStoreId: string;
  merchantId: string;
  units: number;
}

const keyOf = (store: string, merchant: string) => `${store}\u0000${merchant}`;

/** The units of every store and merchant at the end of each given Cairo day, from the stock. */
export async function unitsAtDayEnds(db: Db, days: string[]): Promise<Map<string, UnitsRow[]>> {
  const out = new Map<string, UnitsRow[]>();
  if (days.length === 0) return out;
  const earliest = [...days].sort()[0]!;
  const since = cairoDayStart(addDays(earliest, 1));
  const [current, moves] = await Promise.all([
    db.$queryRaw<{ store: string; merchant: string; units: bigint }[]>`
      SELECT b.dark_store_id AS store, s.merchant_id AS merchant, SUM(bs.quantity)::bigint AS units
      FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id JOIN skus s ON s.id = bs.sku_id
      WHERE bs.quantity <> 0
      GROUP BY 1, 2`,
    db.$queryRaw<{ day: string; store: string; merchant: string; units: bigint }[]>`
      SELECT to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
        b.dark_store_id AS store, s.merchant_id AS merchant, SUM(m.quantity)::bigint AS units
      FROM stock_movements m JOIN bins b ON b.id = m.to_bin_id JOIN skus s ON s.id = m.sku_id
      WHERE m.created_at >= ${since}
      GROUP BY 1, 2, 3
      UNION ALL
      SELECT to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
        b.dark_store_id AS store, s.merchant_id AS merchant, -SUM(m.quantity)::bigint AS units
      FROM stock_movements m JOIN bins b ON b.id = m.from_bin_id JOIN skus s ON s.id = m.sku_id
      WHERE m.created_at >= ${since}
      GROUP BY 1, 2, 3`,
  ]);
  for (const day of days) {
    const units = new Map<string, UnitsRow>();
    const add = (store: string, merchant: string, n: number) => {
      const k = keyOf(store, merchant);
      const row = units.get(k) ?? { darkStoreId: store, merchantId: merchant, units: 0 };
      row.units += n;
      units.set(k, row);
    };
    for (const c of current) add(c.store, c.merchant, Number(c.units));
    // Undo what moved after the day ended.
    for (const m of moves) if (m.day > day) add(m.store, m.merchant, -Number(m.units));
    out.set(
      day,
      [...units.values()].filter((r) => r.units > 0),
    );
  }
  return out;
}

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);

/** Snapshot rows already written for these days, by day (days without rows are left out). */
async function snapshots(db: Db, days: string[]) {
  const rows = await db.stockUnitDay.findMany({
    where: { day: { in: days.map(dayDate) } },
    select: { darkStoreId: true, merchantId: true, day: true, units: true },
  });
  const out = new Map<string, UnitsRow[]>();
  for (const r of rows) {
    const day = dayText(r.day);
    const list = out.get(day) ?? [];
    list.push({ darkStoreId: r.darkStoreId, merchantId: r.merchantId, units: r.units });
    out.set(day, list);
  }
  return out;
}

/**
 * The units of each day: the day's snapshot when it was written, else worked out from the
 * stock (and written now, once: the first writer wins, so a repeat changes nothing).
 */
export async function unitsForDays(db: Db, days: string[]) {
  const have = await snapshots(db, days);
  const missing = days.filter((d) => !have.has(d));
  if (missing.length) {
    const worked = await unitsAtDayEnds(db, missing);
    for (const [day, rows] of worked) {
      if (rows.length)
        await db.stockUnitDay.createMany({
          data: rows.map((r) => ({ ...r, day: dayDate(day) })),
          skipDuplicates: true,
        });
      have.set(day, rows);
    }
  }
  return have;
}

/**
 * The daily storage charge, catching up days the server missed (it sleeps on a free plan):
 * every Cairo day after the last one done, up to the last closed day, at most
 * storage.catch_up_days of them (older missed days stay uncharged). The last day done is the
 * newest storage_days row or, before that table existed, the newest storage_fee entry. Each
 * day writes its units snapshot (every merchant, whether or not they pay storage), charges
 * those units (keys stay storage:<day>:<store>:<merchant>, so nothing is charged twice) and
 * is marked done; a day inside closed books is skipped (accrueStorage) and marked done too.
 */
export async function chargeStorageDays(db: Db, now: Date = new Date()) {
  const last = lastClosedDay(now);
  const cap = Math.max(1, await getSetting(db, 'storage.catch_up_days'));
  const [run, fee] = await Promise.all([
    db.storageDay.findFirst({ orderBy: { day: 'desc' }, select: { day: true } }),
    db.$queryRaw<{ day: string | null }[]>`
      SELECT MAX(data->>'day') AS day FROM ledger_entries WHERE kind = 'storage_fee'`,
  ]);
  const done = [run ? dayText(run.day) : null, fee[0]?.day ?? null]
    .filter((d): d is string => d !== null)
    .sort()
    .pop();
  const earliest = addDays(last, -(cap - 1));
  let first = done ? addDays(done, 1) : last;
  if (first < earliest) first = earliest;
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  if (days.length === 0) return { days: [] as string[], charged: 0 };
  const units = await unitsForDays(db, days);
  let charged = 0;
  for (const day of days) {
    const result = await accrueStorage(db, day, units.get(day) ?? []);
    charged += result.charged;
    await db.storageDay.createMany({
      data: [{ day: dayDate(day), charged: result.charged }],
      skipDuplicates: true,
    });
  }
  return { days, charged };
}

/**
 * Unit days per store and merchant over a range of Cairo days (both included): the daily
 * snapshots, with any day that has none worked out from the stock (not written: a report
 * only reads). For merchant profit's rent share.
 */
export async function unitDays(db: Db, from: string, to: string) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const have = await snapshots(db, days);
  const missing = days.filter((d) => !have.has(d));
  const worked = missing.length ? await unitsAtDayEnds(db, missing) : new Map();
  const total = new Map<string, Map<string, number>>();
  for (const day of days)
    for (const r of have.get(day) ?? worked.get(day) ?? []) {
      const m = total.get(r.darkStoreId) ?? new Map<string, number>();
      m.set(r.merchantId, (m.get(r.merchantId) ?? 0) + r.units);
      total.set(r.darkStoreId, m);
    }
  return total;
}
