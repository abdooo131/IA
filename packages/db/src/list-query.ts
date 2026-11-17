import {
  type AccessProfile,
  cairoDay,
  type ListDef,
  LIST_MAX_ROWS,
  listKnownOf,
  type ListMeta,
  type ListQuery,
  type ListResult,
  type ListState,
  parseListState,
  runList,
  validListValue,
} from '@shiplynow/shared';
import type { Db } from './client';
import { runSqlList, type SqlList } from './list-sql';

// The one list query helper every list view endpoint uses (Accounting's lists and the other
// apps' lists): reads the list state from the query (the list's default filters when the
// address names none), loads the rows inside the person's scope and runs the state over them
// (search, filters, value filters, grouping with subtotals, totals, sorting and paging).

/** Who is looking: their stores and merchants when they are limited (null: all). */
export interface ListScope {
  userId: string;
  storeIds: string[] | null;
  merchantIds: string[] | null;
  /** Their access profile, for lists that hide rows of other apps (alerts) */
  access?: AccessProfile;
}

/** A list's definition and how its rows are loaded (state: to narrow the load by values). */
export interface RegisteredList {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  def: ListDef<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  load: (db: Db, scope: ListScope, state: ListState, now: Date) => Promise<any[]>;
  /** The list's database twins (list-sql.ts): search, filters, sorting and paging in SQL */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql?: SqlList<any>;
}

/** The list state a query names, with unknown keys and malformed values dropped. */
export function listStateOf(meta: ListMeta, query: ListQuery): ListState {
  const state = parseListState(query, listKnownOf(meta), {
    filters: [...meta.defaultFilters],
  });
  const values = Object.fromEntries(
    Object.entries(state.values).filter(([k, v]) => validListValue(meta.values?.[k], v)),
  );
  return { ...state, values };
}

export async function queryList(
  db: Db,
  entry: RegisteredList,
  meta: ListMeta,
  query: ListQuery,
  scope: ListScope,
  now: Date = new Date(),
  /** For tests: the list's own loader and the shared engine, never its database twins */
  options: { memory?: boolean } = {},
): Promise<ListResult<Record<string, unknown>> & { truncated: boolean }> {
  const state = listStateOf(meta, query);
  const ctx = { today: cairoDay(now), userId: scope.userId };
  const run = {
    open: query.open ? query.open.split('\n') : undefined,
    all: query.all === '1',
  };
  if (entry.sql && !options.memory)
    return runSqlList(db, entry.sql, entry.def, state, scope, ctx, { ...run, now });
  const rows = await entry.load(db, scope, state, now);
  // Loaders take the newest LIST_MAX_ROWS rows: a full load may have left older ones out.
  return { ...runList(rows, entry.def, state, ctx, run), truncated: rows.length >= LIST_MAX_ROWS };
}

/** For tests: every filter, value filter, grouping and sort a list's meta names exists. */
export function listGaps(id: string, meta: ListMeta, entry: RegisteredList): string[] {
  const gaps: string[] = [];
  const def = entry.def;
  for (const [f, group] of Object.entries(meta.filters))
    if (def.filters[f]?.group !== group) gaps.push(`${id}.filter.${f}`);
  for (const f of Object.keys(def.filters))
    if (!(f in meta.filters)) gaps.push(`${id}.extra_filter.${f}`);
  for (const v of Object.keys(meta.values ?? {}))
    if (!def.values?.[v]) gaps.push(`${id}.value.${v}`);
  for (const v of Object.keys(def.values ?? {}))
    if (!(v in (meta.values ?? {}))) gaps.push(`${id}.extra_value.${v}`);
  for (const g of meta.groupBys) if (!def.groupBys[g]) gaps.push(`${id}.group.${g}`);
  for (const s of meta.sorts) if (!def.sorts[s]) gaps.push(`${id}.sort.${s}`);
  return gaps;
}
