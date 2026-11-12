import { z } from 'zod';

// Odoo style list views (docs/ARCHITECTURE.md "List views and document pages"). A list's state
// lives in the address so a view can be shared and Back works: q (typed search), f (predefined
// filters, comma separated), g (group by, one or two levels), sort and desc, page and size,
// and v (value filters: a store, a merchant, a first or last Cairo day, as key:value pairs).
// The API runs the same state on its rows (runList): filters in one group are OR'ed, groups of
// filters are AND'ed, as in Odoo. Everything here is pure so the web and the API share it.

export const LIST_PAGE_SIZES = [25, 50, 100, 200] as const;
export const LIST_DEFAULT_PAGE_SIZE = 50;
/** The most rows a list loads before filtering (the most recent ones); exports stop there too. */
export const LIST_MAX_ROWS = 5000;
/** Group by goes at most two levels deep. */
export const LIST_MAX_GROUP_LEVELS = 2;

export interface ListState {
  q: string;
  filters: string[];
  groupBy: string[];
  sort: string | null;
  desc: boolean;
  page: number;
  pageSize: number;
  /** Value filters (a chosen store, merchant or day): key → value, AND'ed with the rest */
  values: Record<string, string>;
}

export const EMPTY_LIST_STATE: ListState = {
  q: '',
  filters: [],
  groupBy: [],
  sort: null,
  desc: false,
  page: 1,
  pageSize: LIST_DEFAULT_PAGE_SIZE,
  values: {},
};

/**
 * How a value filter is chosen: one of a list (a store, a merchant, an alert type), or a
 * Cairo day that starts (day_from) or ends (day_to) a range, both days included.
 */
export type ListValueKind = 'option' | 'day_from' | 'day_to';

/**
 * What a list offers, shared by the API (which implements it) and the web (which builds its
 * menus from it): predefined filters (key → the group they OR within), value filters,
 * groupings, sortable columns, summed money columns and the filters it opens with.
 */
export interface ListMeta {
  filters: Record<string, string>;
  values?: Record<string, ListValueKind>;
  groupBys: readonly string[];
  sorts: readonly string[];
  sums: readonly string[];
  defaultFilters: readonly string[];
}

/** The keys parseListState accepts for a list. */
export function listKnownOf(meta: ListMeta): ListKnown {
  return {
    filters: Object.keys(meta.filters),
    groupBys: meta.groupBys,
    sorts: meta.sorts,
    values: Object.keys(meta.values ?? {}),
  };
}

/** URLSearchParams (or Next's ReadonlyURLSearchParams), without needing DOM types here. */
interface ParamsLike {
  get(key: string): string | null;
}
type ParamSource = ParamsLike | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string | undefined {
  if (typeof (source as ParamsLike).get === 'function')
    return (source as ParamsLike).get(key) ?? undefined;
  source = source as Record<string, string | string[] | undefined>;
  const v = source[key];
  return Array.isArray(v) ? v[0] : v;
}

const KEY = /^[a-z0-9_]{1,40}$/;
/** A value filter's value: an id or a YYYY-MM-DD day. */
const VALUE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const list = (value: string | undefined) =>
  [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => KEY.test(s)),
    ),
  ] as string[];

/** Whether the address names any list state (else the list's default view applies). */
export function hasListState(source: ParamSource) {
  return ['q', 'f', 'g', 'sort', 'page', 'size', 'v'].some((k) => read(source, k) !== undefined);
}

export interface ListKnown {
  filters?: readonly string[];
  groupBys?: readonly string[];
  sorts?: readonly string[];
  /** Value filter keys */
  values?: readonly string[];
}

/** Reads v=store:abc,from:2026-11-01 into { store: 'abc', from: '2026-11-01' }. */
function readValues(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (value ?? '').split(',')) {
    const at = part.indexOf(':');
    if (at < 1) continue;
    const k = part.slice(0, at).trim();
    const v = part.slice(at + 1).trim();
    if (KEY.test(k) && VALUE.test(v)) out[k] = v;
  }
  return out;
}

/** Whether a value suits its kind (a day filter takes only a YYYY-MM-DD day). */
export function validListValue(kind: ListValueKind | undefined, value: string) {
  if (!VALUE.test(value)) return false;
  return kind === 'day_from' || kind === 'day_to' ? DAY.test(value) : true;
}

/**
 * Reads a list's state from search params. Unknown filters, groupings and sorts are dropped
 * when `known` is given, so a stale shared link still opens.
 */
export function parseListState(
  source: ParamSource,
  known: ListKnown = {},
  defaults: Partial<ListState> = {},
): ListState {
  const base = { ...EMPTY_LIST_STATE, ...defaults };
  const fParam = read(source, 'f');
  const gParam = read(source, 'g');
  let filters = fParam === undefined ? base.filters : list(fParam);
  let groupBy = gParam === undefined ? base.groupBy : list(gParam);
  if (known.filters) filters = filters.filter((f) => known.filters!.includes(f));
  if (known.groupBys) groupBy = groupBy.filter((g) => known.groupBys!.includes(g));
  groupBy = groupBy.slice(0, LIST_MAX_GROUP_LEVELS);
  const sortParam = read(source, 'sort');
  let sort = sortParam && KEY.test(sortParam) ? sortParam : base.sort;
  if (sort && known.sorts && !known.sorts.includes(sort)) sort = base.sort;
  const vParam = read(source, 'v');
  let values = vParam === undefined ? { ...base.values } : readValues(vParam);
  if (known.values)
    values = Object.fromEntries(Object.entries(values).filter(([k]) => known.values!.includes(k)));
  const page = Number.parseInt(read(source, 'page') ?? '', 10);
  const size = Number.parseInt(read(source, 'size') ?? '', 10);
  return {
    q: (read(source, 'q') ?? base.q).slice(0, 120),
    filters,
    groupBy,
    sort,
    desc: sortParam ? read(source, 'desc') === '1' : base.desc,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    pageSize: (LIST_PAGE_SIZES as readonly number[]).includes(size) ? size : base.pageSize,
    values,
  };
}

/**
 * Writes a list's state as search params, leaving out what is at its default. Filters are
 * always written (even empty), so removing the last filter does not bring the defaults back.
 */
export function serializeListState(state: ListState): string {
  const p: [string, string][] = [];
  if (state.q.trim()) p.push(['q', state.q.trim()]);
  p.push(['f', state.filters.join(',')]);
  if (state.groupBy.length) p.push(['g', state.groupBy.join(',')]);
  if (state.sort) {
    p.push(['sort', state.sort]);
    if (state.desc) p.push(['desc', '1']);
  }
  if (state.page > 1) p.push(['page', String(state.page)]);
  if (state.pageSize !== LIST_DEFAULT_PAGE_SIZE) p.push(['size', String(state.pageSize)]);
  const values = Object.entries(state.values ?? {})
    .filter(([k, v]) => KEY.test(k) && VALUE.test(v))
    .sort(([a], [b]) => a.localeCompare(b));
  if (values.length) p.push(['v', values.map(([k, v]) => `${k}:${v}`).join(',')]);
  // Encoded as URLSearchParams would (spaces as +), commas and colons kept readable.
  const enc = (s: string) =>
    encodeURIComponent(s).replace(/%20/g, '+').replace(/%2C/g, ',').replace(/%3A/g, ':');
  return p.map(([k, v]) => `${k}=${enc(v)}`).join('&');
}

/** Toggles a filter; a change of what is shown always goes back to the first page. */
export function toggleFilter(state: ListState, key: string): ListState {
  const on = state.filters.includes(key);
  return {
    ...state,
    page: 1,
    filters: on ? state.filters.filter((f) => f !== key) : [...state.filters, key],
  };
}

/** Sets a value filter, or removes it when the value is empty. */
export function setListValue(state: ListState, key: string, value: string | null): ListState {
  const values = { ...state.values };
  if (value) values[key] = value;
  else delete values[key];
  return { ...state, page: 1, values };
}

/** Adds a grouping (at most two levels), or removes it when it is already on. */
export function toggleGroupBy(state: ListState, key: string): ListState {
  const on = state.groupBy.includes(key);
  const groupBy = on
    ? state.groupBy.filter((g) => g !== key)
    : [...state.groupBy, key].slice(-LIST_MAX_GROUP_LEVELS);
  return { ...state, page: 1, groupBy };
}

/** Sorts by a column; the same column again flips the direction. */
export function sortBy(state: ListState, key: string): ListState {
  return {
    ...state,
    page: 1,
    sort: key,
    desc: state.sort === key ? !state.desc : false,
  };
}

// ─── facet chips ────────────────────────────────────────────────────────────────

export interface FacetLabels {
  /** filter key → its label */
  filters: Record<string, string>;
  /** filter key → its group (filters of one group make one chip, joined by "or") */
  filterGroups: Record<string, string>;
  /** group by key → its label */
  groupBys: Record<string, string>;
  /** "or" in the reader's language */
  or: string;
  /** value filter key → its label (Store, From) */
  values?: Record<string, string>;
  /** A value filter's value as the reader sees it (a store's name, a day first date) */
  valueText?: (key: string, value: string) => string;
}

export interface Facet {
  kind: 'search' | 'filter' | 'group' | 'value';
  /** Stable key for React and tests */
  id: string;
  /** What the chip shows */
  values: string[];
  /** The state once this chip is removed */
  without: ListState;
  /** How values are joined on the chip ("or" for filters, › for groupings) */
  joiner: string;
}

/** The chips a search bar shows: the typed text, each filter group, and the grouping. */
export function facetsOf(state: ListState, labels: FacetLabels): Facet[] {
  const facets: Facet[] = [];
  if (state.q.trim())
    facets.push({
      kind: 'search',
      id: 'search',
      values: [state.q.trim()],
      without: { ...state, q: '', page: 1 },
      joiner: '',
    });
  const groups = new Map<string, string[]>();
  for (const f of state.filters) {
    const g = labels.filterGroups[f] ?? f;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  for (const [group, keys] of groups)
    facets.push({
      kind: 'filter',
      id: `filter:${group}`,
      values: keys.map((k) => labels.filters[k] ?? k),
      without: { ...state, page: 1, filters: state.filters.filter((f) => !keys.includes(f)) },
      joiner: ` ${labels.or} `,
    });
  for (const [key, value] of Object.entries(state.values ?? {})) {
    const rest = { ...state.values };
    delete rest[key];
    facets.push({
      kind: 'value',
      id: `value:${key}`,
      values: [`${labels.values?.[key] ?? key}: ${labels.valueText?.(key, value) ?? value}`],
      without: { ...state, page: 1, values: rest },
      joiner: '',
    });
  }
  if (state.groupBy.length)
    facets.push({
      kind: 'group',
      id: 'group',
      values: state.groupBy.map((g) => labels.groupBys[g] ?? g),
      without: { ...state, page: 1, groupBy: [] },
      joiner: ' › ',
    });
  return facets;
}

// ─── the engine the API runs ───────────────────────────────────────────────────

export interface ListCtx {
  /** Today in Cairo (YYYY-MM-DD) for date filters */
  today: string;
  /** The person looking, for "mine" and "not mine" filters */
  userId: string;
}

export interface GroupValue {
  key: string;
  label: string;
}

export interface ListDef<R extends { id: string }> {
  id: string;
  /** Predefined filters: rows pass when they pass one filter of every group in use */
  filters: Record<string, { group: string; test: (row: R, ctx: ListCtx) => boolean }>;
  /** What each grouping puts a row under */
  groupBys: Record<string, (row: R) => GroupValue>;
  /** Value filters: a row passes when it matches every value chosen */
  values?: Record<string, (row: R, value: string, ctx: ListCtx) => boolean>;
  /** The texts typed search looks in */
  search: (row: R) => (string | number | null | undefined)[];
  /** Sortable columns */
  sorts: Record<string, (row: R) => string | number | null>;
  defaultSort: { key: string; desc: boolean };
  /** Money (or count) columns summed into totals and group subtotals */
  sums: readonly string[];
  /** The filters a list opens with when the address names none */
  defaultFilters?: readonly string[];
}

export interface ListGroup {
  key: string;
  label: string;
  count: number;
  totals: Record<string, number>;
  /** The second level, when grouped by two */
  groups?: ListGroup[];
}

export interface ListResult<R> {
  total: number;
  page: number;
  pageSize: number;
  rows: R[];
  /** Sums of the money columns over every row that passed, not only this page */
  totals: Record<string, number>;
  /** Groups (with counts and subtotals) when grouped and no group was opened */
  groups: ListGroup[] | null;
}

/** Folds Arabic letter forms and case so typed search finds what people mean. */
export function foldSearch(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function totalsOf<R>(rows: R[], sums: readonly string[]) {
  const totals: Record<string, number> = {};
  for (const key of sums) {
    let sum = 0;
    for (const r of rows) {
      const v = (r as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
    totals[key] = sum;
  }
  return totals;
}

/** Applies search and filters (no sorting, grouping or paging). */
export function filterRows<R extends { id: string }>(
  rows: R[],
  def: ListDef<R>,
  state: ListState,
  ctx: ListCtx,
): R[] {
  const words = foldSearch(state.q).split(' ').filter(Boolean);
  const groups = new Map<string, ((row: R, ctx: ListCtx) => boolean)[]>();
  for (const key of state.filters) {
    const f = def.filters[key];
    if (!f) continue;
    groups.set(f.group, [...(groups.get(f.group) ?? []), f.test]);
  }
  const values = Object.entries(state.values ?? {}).flatMap(([key, value]) => {
    const test = def.values?.[key];
    return test ? [(row: R) => test(row, value, ctx)] : [];
  });
  return rows.filter((row) => {
    for (const tests of groups.values()) if (!tests.some((t) => t(row, ctx))) return false;
    for (const test of values) if (!test(row)) return false;
    if (!words.length) return true;
    const hay = foldSearch(
      def
        .search(row)
        .filter((x) => x !== null && x !== undefined)
        .join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}

function groupOf<R extends { id: string }>(
  rows: R[],
  def: ListDef<R>,
  levels: string[],
): ListGroup[] {
  const [level, ...rest] = levels;
  const by = level ? def.groupBys[level] : undefined;
  if (!by) return [];
  const map = new Map<string, { label: string; rows: R[] }>();
  for (const r of rows) {
    const g = by(r);
    const entry = map.get(g.key) ?? { label: g.label, rows: [] };
    entry.rows.push(r);
    map.set(g.key, entry);
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      count: g.rows.length,
      totals: totalsOf(g.rows, def.sums),
      ...(rest.length ? { groups: groupOf(g.rows, def, rest) } : {}),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function sortRows<R extends { id: string }>(rows: R[], def: ListDef<R>, state: ListState) {
  const key = state.sort && def.sorts[state.sort] ? state.sort : def.defaultSort.key;
  const desc = state.sort && def.sorts[state.sort] ? state.desc : def.defaultSort.desc;
  const get = def.sorts[key];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    const c =
      typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
}

/**
 * Runs a list's state over its rows: search, filters, totals, then either the groups (when
 * grouped and no group is opened) or one sorted page of rows. `open` names the group path
 * whose rows are wanted (one key per grouping level); `all` returns every row (exports).
 */
export function runList<R extends { id: string }>(
  rows: R[],
  def: ListDef<R>,
  state: ListState,
  ctx: ListCtx,
  options: { open?: string[]; all?: boolean } = {},
): ListResult<R> {
  let passed = filterRows(rows, def, state, ctx);
  const levels = state.groupBy.filter((g) => def.groupBys[g]);
  const open = options.open ?? [];
  if (levels.length && !options.all) {
    if (open.length === 0) {
      return {
        total: passed.length,
        page: 1,
        pageSize: state.pageSize,
        rows: [],
        totals: totalsOf(passed, def.sums),
        groups: groupOf(passed, def, levels),
      };
    }
    passed = passed.filter((r) =>
      open.every((key, i) => {
        const by = def.groupBys[levels[i] ?? ''];
        return by ? by(r).key === key : true;
      }),
    );
  }
  const sorted = sortRows(passed, def, state);
  const totals = totalsOf(passed, def.sums);
  if (options.all)
    return {
      total: sorted.length,
      page: 1,
      pageSize: sorted.length,
      rows: sorted,
      totals,
      groups: null,
    };
  const pages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
  const page = Math.min(state.page, pages);
  return {
    total: sorted.length,
    page,
    pageSize: state.pageSize,
    rows: sorted.slice((page - 1) * state.pageSize, page * state.pageSize),
    totals,
    groups: null,
  };
}

/** The query the list endpoints take: the list state plus an opened group and exports. */
export const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  f: z.string().max(400).optional(),
  g: z.string().max(100).optional(),
  sort: z.string().max(40).optional(),
  desc: z.string().max(1).optional(),
  page: z.string().max(6).optional(),
  size: z.string().max(4).optional(),
  /** Value filters: key:value pairs, comma separated */
  v: z.string().max(400).optional(),
  /** The opened group: one key per level, joined by a newline */
  open: z.string().max(400).optional(),
  /** 1: every row that passes (for exports), no paging */
  all: z.string().max(1).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// ─── favourites and columns ─────────────────────────────────────────────────────

export const listFavoriteSchema = z.object({
  listKey: z.string().regex(KEY),
  name: z.string().trim().min(1).max(60),
  /** The serialized list state (serializeListState) */
  query: z.string().max(800),
  isDefault: z.boolean().default(false),
});

export const listColumnsSchema = z.object({
  columns: z.array(z.string().regex(KEY)).max(40),
});

// ─── notes and activities on any record (the chatter) ─────────────────────────

export const recordNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const recordActivitySchema = z.object({
  /** Cairo day the reminder is due (YYYY-MM-DD) */
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(1).max(500),
  /** Who is reminded; the person writing it when left out */
  assigneeId: z.string().min(1).max(40).optional(),
});

export const bulkIdsSchema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1).max(200),
});

export const bulkDecideSchema = bulkIdsSchema.extend({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

/** One outcome per record of a bulk action: each is still checked on its own. */
export interface BulkOutcome {
  id: string;
  ok: boolean;
  error?: string;
}
