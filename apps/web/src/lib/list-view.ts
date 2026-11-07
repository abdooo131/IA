import type { ExportCell, ListResult } from '@shiplynow/shared';

// Pure helpers of the Odoo style list view (components/odoo/ListView): column kinds, exports,
// the address and the previous/next record navigation of document pages.

export type ColumnKind =
  'text' | 'ltr' | 'money' | 'number' | 'date' | 'datetime' | 'status' | 'bool';

export interface ListColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Hidden until the person picks it in the column chooser */
  optional?: boolean;
  /** The list's sort key for this column (sortable when set) */
  sort?: string;
  /** The card title on phones */
  primary?: boolean;
}

export interface BulkAction {
  key: string;
  label: string;
  /** POSTed with { ids, note?, ...body } and answers { results: BulkOutcome[] } */
  endpoint: string;
  body?: Record<string, unknown>;
  note?: 'required' | 'optional';
  tone?: 'primary' | 'danger';
}

export interface ListViewConfig {
  /** Favourites and chosen columns are kept per list id */
  listId: string;
  /** The list endpoint (GET, the list state as query) */
  endpoint: string;
  columns: ListColumn[];
  filters: { key: string; group: string; label: string }[];
  groupBys: { key: string; label: string }[];
  /** column or group by key → value → label (statuses, kinds) */
  valueLabels: Record<string, Record<string, string>>;
  /** Each row opens this page; {id} is replaced by the row's id */
  rowHref?: string;
  bulkActions?: BulkAction[];
  defaultFilters: string[];
  /** File name of exports, without extension */
  exportName: string;
}

export type ListRow = Record<string, unknown> & { id: string };
export type ListData = ListResult<ListRow>;

/** The list state params; anything else in the address (a tab) is kept. */
const LIST_PARAMS = ['q', 'f', 'g', 'sort', 'desc', 'page', 'size'];

/** Puts a serialized list state into the current address, keeping its other params. */
export function withListState(current: string, listQuery: string): string {
  const keep = new URLSearchParams(current);
  for (const k of LIST_PARAMS) keep.delete(k);
  const next = new URLSearchParams(listQuery);
  for (const [k, v] of keep) next.set(k, v);
  return next.toString();
}

export function rowHrefOf(template: string | undefined, row: { id: string }) {
  return template ? template.replace('{id}', encodeURIComponent(row.id)) : null;
}

const day = (v: string) => v.slice(0, 10);

/** A cell as text for the screen (money and dates are formatted by the caller). */
export function labelOf(
  config: Pick<ListViewConfig, 'valueLabels'>,
  key: string,
  value: unknown,
): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return config.valueLabels[key]?.[s] ?? s;
}

/**
 * The rows of an export: one column per visible column, money as EGP numbers (two decimals,
 * so Excel adds them up), dates as YYYY-MM-DD and statuses in the reader's words.
 */
export function exportTable(
  config: Pick<ListViewConfig, 'valueLabels'>,
  columns: ListColumn[],
  rows: ListRow[],
  yesNo: { yes: string; no: string },
): { header: string[]; rows: ExportCell[][] } {
  return {
    header: columns.map((c) => c.label),
    rows: rows.map((r) =>
      columns.map((c): ExportCell => {
        const v = r[c.key];
        if (v === null || v === undefined) return null;
        switch (c.kind) {
          case 'money':
            return typeof v === 'number' ? Math.round(v) / 100 : null;
          case 'number':
            return typeof v === 'number' ? v : Number(v);
          case 'date':
            return day(String(v));
          case 'datetime':
            return String(v).replace('T', ' ').slice(0, 16);
          case 'bool':
            return v ? yesNo.yes : yesNo.no;
          case 'status':
            return labelOf(config, c.key, v);
          default:
            return labelOf(config, c.key, v);
        }
      }),
    ),
  };
}

// ─── previous and next record ───────────────────────────────────────────────────

export const DOC_NAV_KEY = 'shiply-doc-nav';

export interface DocNav {
  /** The list's address, for the breadcrumb back to it */
  listUrl: string;
  /** The ids of the rows the person saw, in order */
  ids: string[];
  /** The document page of a row ({id}) */
  hrefTemplate: string;
}

/** Where a record sits in the list the person came from, with its neighbours. */
export function docNeighbours(nav: DocNav | null, id: string) {
  if (!nav) return null;
  const index = nav.ids.indexOf(id);
  if (index < 0) return null;
  const href = (i: number) =>
    i >= 0 && i < nav.ids.length ? nav.hrefTemplate.replace('{id}', nav.ids[i]!) : null;
  return {
    index: index + 1,
    count: nav.ids.length,
    prev: href(index - 1),
    next: href(index + 1),
    listUrl: nav.listUrl,
  };
}

export function readDocNav(text: string | null): DocNav | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as DocNav;
    return Array.isArray(v.ids) && typeof v.hrefTemplate === 'string' ? v : null;
  } catch {
    return null;
  }
}
