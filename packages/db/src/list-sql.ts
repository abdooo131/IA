import { Prisma } from '@prisma/client';
import {
  foldSearch,
  type ListCtx,
  type ListDef,
  LIST_MAX_ROWS,
  type ListResult,
  type ListState,
  runList,
} from '@shiplynow/shared';
import type { Db } from './client';
import type { ListScope } from './list-query';

// Lists that run in the database (review step 4, growth). The busiest lists (orders, alerts,
// stock) describe their filters, value filters, search and sortable columns as SQL twins of
// their in memory definitions (ListDef). When everything the address asks for has a twin and
// nothing is grouped, the database counts, sums and pages the rows and only one page is loaded
// (so paging, search and totals reach every row, not only the newest LIST_MAX_ROWS). Otherwise
// the database still applies every twin it has before taking the newest LIST_MAX_ROWS, and the
// shared engine (runList) does the rest in memory as before, saying when rows were left out.
//
// A twin must answer exactly as its in memory test does; packages/db/test/list-sql.test.ts
// runs the same addresses both ways and compares them.

export interface SqlSort {
  expr: Prisma.Sql;
  /** Text compared as people read it (ICU, as String.localeCompare) rather than byte order */
  text?: boolean;
}

export interface SqlList<R extends { id: string }> {
  /** FROM with its joins; expressions below use its aliases */
  from: (db: Db, scope: ListScope, state: ListState) => Promise<Prisma.Sql> | Prisma.Sql;
  /** The row's id as the list's rows carry it */
  id: Prisma.Sql;
  /** Conditions every row meets: the person's stores and merchants */
  where: (scope: ListScope) => Prisma.Sql[];
  /** Predefined filters with a twin */
  filters: Record<string, (ctx: ListCtx) => Prisma.Sql>;
  /** Value filters with a twin */
  values: Record<string, (value: string) => Prisma.Sql>;
  /** The texts typed search looks in, in the order of the list's search */
  search?: Prisma.Sql[];
  /** Sortable columns with a twin */
  sorts: Record<string, SqlSort>;
  /** The order rows are loaded in: the tie break of every sort, as the in memory sort keeps it */
  order: Prisma.Sql;
  /** The summed columns */
  sums: Record<string, Prisma.Sql>;
  /** The full rows for these ids (any order) */
  rows: (db: Db, ids: string[], scope: ListScope, state: ListState, now: Date) => Promise<R[]>;
}

const and = (parts: Prisma.Sql[]) =>
  parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
const or = (parts: Prisma.Sql[]) => Prisma.sql`(${Prisma.join(parts, ' OR ')})`;

/** Whether this database has the ICU root collation (Postgres built with ICU). */
let icu: Promise<boolean> | null = null;
function hasIcu(db: Db) {
  icu ??= db.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM pg_collation WHERE collname = 'und-x-icu'`
    .then((r) => (r[0]?.n ?? 0) > 0)
    .catch(() => false);
  return icu;
}

interface Plan {
  where: Prisma.Sql;
  /** Every filter, value and the search ran in the database */
  complete: boolean;
}

/** The conditions of a state that have a twin (a filter group only when all its filters do). */
function plan<R extends { id: string }>(
  spec: SqlList<R>,
  def: ListDef<R>,
  state: ListState,
  scope: ListScope,
  ctx: ListCtx,
): Plan {
  const parts = [...spec.where(scope)];
  let complete = true;
  const groups = new Map<string, string[]>();
  for (const key of state.filters) {
    const f = def.filters[key];
    if (!f) continue;
    groups.set(f.group, [...(groups.get(f.group) ?? []), key]);
  }
  for (const keys of groups.values()) {
    if (keys.every((k) => spec.filters[k])) parts.push(or(keys.map((k) => spec.filters[k]!(ctx))));
    else complete = false;
  }
  for (const [key, value] of Object.entries(state.values ?? {})) {
    if (!def.values?.[key]) continue;
    const twin = spec.values[key];
    if (twin) parts.push(twin(value));
    else complete = false;
  }
  const words = foldSearch(state.q).split(' ').filter(Boolean);
  if (words.length) {
    if (spec.search) {
      const hay = Prisma.sql`sn_fold(concat_ws(' ', ${Prisma.join(spec.search, ', ')}))`;
      for (const w of words) parts.push(Prisma.sql`strpos(${hay}, ${w}) > 0`);
    } else complete = false;
  }
  return { where: and(parts), complete };
}

async function idsOf(
  db: Db,
  from: Prisma.Sql,
  id: Prisma.Sql,
  where: Prisma.Sql,
  order: Prisma.Sql,
  limit: number,
  offset = 0,
) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT ${id} AS id FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => r.id);
}

async function rowsInOrder<R extends { id: string }>(
  spec: SqlList<R>,
  db: Db,
  ids: string[],
  scope: ListScope,
  state: ListState,
  now: Date,
) {
  if (!ids.length) return [];
  const byId = new Map((await spec.rows(db, ids, scope, state, now)).map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export type SqlListResult<R> = ListResult<R> & {
  /** Rows were left out: more than LIST_MAX_ROWS passed what the database could apply */
  truncated: boolean;
};

/**
 * Runs a list's state: in the database when it can (see above), else the newest
 * LIST_MAX_ROWS rows the database narrowed, through the shared engine.
 */
export async function runSqlList<R extends { id: string }>(
  db: Db,
  spec: SqlList<R>,
  def: ListDef<R>,
  state: ListState,
  scope: ListScope,
  ctx: ListCtx,
  options: { open?: string[]; all?: boolean; now?: Date } = {},
): Promise<SqlListResult<R>> {
  const now = options.now ?? new Date();
  const from = await spec.from(db, scope, state);
  const { where, complete } = plan(spec, def, state, scope, ctx);
  const grouped = !options.all && state.groupBy.some((g) => def.groupBys[g]);
  const sortKey = state.sort && def.sorts[state.sort] ? state.sort : def.defaultSort.key;
  const desc = state.sort && def.sorts[state.sort] ? state.desc : def.defaultSort.desc;
  const sort = spec.sorts[sortKey];
  const textOk = !sort?.text || (await hasIcu(db));

  if (complete && !grouped && sort && textOk) {
    const sums = Object.entries(spec.sums);
    const [head] = await db.$queryRaw<Record<string, bigint | number | null>[]>`
      SELECT count(*)::bigint AS total
      ${
        sums.length
          ? Prisma.sql`, ${Prisma.join(
              sums.map(
                ([k, e]) => Prisma.sql`COALESCE(SUM(${e}), 0)::bigint AS ${Prisma.raw(`"${k}"`)}`,
              ),
              ', ',
            )}`
          : Prisma.empty
      }
      FROM ${from} WHERE ${where}`;
    const total = Number(head?.total ?? 0);
    const totals = Object.fromEntries(sums.map(([k]) => [k, Number(head?.[k] ?? 0)]));
    for (const k of def.sums) totals[k] ??= 0;
    const expr = sort.text ? Prisma.sql`(${sort.expr}) COLLATE "und-x-icu"` : sort.expr;
    const order = Prisma.sql`${expr} ${Prisma.raw(desc ? 'DESC' : 'ASC')} NULLS LAST, ${spec.order}`;
    if (options.all) {
      const ids = await idsOf(db, from, spec.id, where, order, LIST_MAX_ROWS);
      const rows = await rowsInOrder(spec, db, ids, scope, state, now);
      return {
        total: rows.length,
        page: 1,
        pageSize: rows.length,
        rows,
        totals,
        groups: null,
        truncated: total > LIST_MAX_ROWS,
      };
    }
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    const page = Math.min(state.page, pages);
    const ids = await idsOf(
      db,
      from,
      spec.id,
      where,
      order,
      state.pageSize,
      (page - 1) * state.pageSize,
    );
    return {
      total,
      page,
      pageSize: state.pageSize,
      rows: await rowsInOrder(spec, db, ids, scope, state, now),
      totals,
      groups: null,
      truncated: false,
    };
  }

  // In memory: the newest rows the database narrowed with the twins it has.
  const ids = await idsOf(db, from, spec.id, where, spec.order, LIST_MAX_ROWS + 1);
  const truncated = ids.length > LIST_MAX_ROWS;
  const rows = await rowsInOrder(spec, db, ids.slice(0, LIST_MAX_ROWS), scope, state, now);
  return { ...runList(rows, def, state, ctx, options), truncated };
}
