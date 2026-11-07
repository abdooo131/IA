'use client';

import {
  type BulkOutcome,
  exportCsv,
  exportXlsx,
  facetsOf,
  hasListState,
  LIST_PAGE_SIZES,
  type ListGroup,
  type ListState,
  parseListState,
  serializeListState,
  sortBy,
  toggleFilter,
  toggleGroupBy,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import {
  DOC_NAV_KEY,
  type DocNav,
  exportTable,
  labelOf,
  type ListColumn,
  type ListData,
  type ListRow,
  type ListViewConfig,
  rowHrefOf,
  withListState,
} from '@/lib/list-view';

// The Odoo style list view (docs/ARCHITECTURE.md "List views and document pages"): a search
// bar with facet chips, Filters, Group by and Favourites, a column chooser, selection with a
// bulk action bar, exports, totals and paging. Its state lives in the address; the page's
// server component fetches the rows for that state, so Back and shared links just work.

interface Favorite {
  id: string;
  name: string;
  query: string;
  isDefault: boolean;
}

const btn =
  'inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-body-sm font-semibold hover:bg-surface-raised disabled:opacity-50';
const menuPanel =
  'absolute z-40 mt-1 max-h-[70dvh] overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-lg';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`shrink-0 transition-transform ${open ? 'rotate-90 rtl:-rotate-90' : 'rtl:rotate-180'}`}
    >
      <path d="M4.5 3 7.5 6 4.5 9" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z" strokeLinejoin="round" />
    </svg>
  );
}

/** Closes a menu on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, close]);
  return ref;
}

export function ListView({
  config,
  data,
  toolbar,
}: {
  config: ListViewConfig;
  data: ListData;
  /** Buttons of the page next to the search (New bill, Prepare payouts) */
  toolbar?: ReactNode;
}) {
  const t = useTranslations('listView');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const known = useMemo(
    () => ({
      filters: config.filters.map((f) => f.key),
      groupBys: config.groupBys.map((g) => g.key),
      sorts: config.columns.flatMap((c) => (c.sort ? [c.sort] : [])),
    }),
    [config],
  );
  const state = parseListState(params, known, { filters: config.defaultFilters });

  const go = (next: ListState, replace = false) => {
    const query = withListState(params.toString(), serializeListState(next));
    startTransition(() => {
      if (replace) router.replace(`${pathname}?${query}`, { scroll: false });
      else router.push(`${pathname}?${query}`, { scroll: false });
    });
  };

  // ─── favourites and columns, per person ───
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    void apiGetClient<Favorite[]>(`/me/list-favorites?list=${config.listId}`).then((r) => {
      if (!live || !r.ok) return;
      setFavorites(r.data);
      // A default favourite opens when the address names no view.
      const def = r.data.find((f) => f.isDefault);
      if (def && !hasListState(new URLSearchParams(window.location.search)))
        router.replace(`${pathname}?${withListState(window.location.search, def.query)}`, {
          scroll: false,
        });
    });
    try {
      const cached = window.localStorage.getItem(`shiply-cols:${config.listId}`);
      if (cached) setChosen(JSON.parse(cached) as string[]);
    } catch {
      /* storage may be off */
    }
    void apiGetClient<{ columns: string[] | null }>(`/me/list-prefs/${config.listId}`).then((r) => {
      if (live && r.ok && r.data.columns) setChosen(r.data.columns);
    });
    return () => {
      live = false;
    };
  }, [config.listId]);

  const visible = config.columns.filter((c) =>
    chosen ? chosen.includes(c.key) || c.primary : !c.optional,
  );
  const saveColumns = (keys: string[]) => {
    setChosen(keys);
    try {
      window.localStorage.setItem(`shiply-cols:${config.listId}`, JSON.stringify(keys));
    } catch {
      /* storage may be off */
    }
    void apiSend('PUT', `/me/list-prefs/${config.listId}`, { columns: keys });
  };

  // ─── selection ───
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = useState<{ ok: number; refused: BulkOutcome[] } | null>(null);
  const [groupRows, setGroupRows] = useState<Record<string, ListRow[]>>({});
  useEffect(() => {
    setSelected(new Set());
    setGroupRows({});
  }, [data]);
  const shown = data.groups ? Object.values(groupRows).flat() : data.rows;
  const allOn = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const rememberNav = (rows: ListRow[]) => {
    if (!config.rowHref) return;
    const nav: DocNav = {
      listUrl: `${pathname}?${params.toString()}`,
      ids: rows.map((r) => r.id),
      hrefTemplate: config.rowHref,
    };
    try {
      window.sessionStorage.setItem(DOC_NAV_KEY, JSON.stringify(nav));
    } catch {
      /* storage may be off */
    }
  };

  const facetLabels = {
    filters: Object.fromEntries(config.filters.map((f) => [f.key, f.label])),
    filterGroups: Object.fromEntries(config.filters.map((f) => [f.key, f.group])),
    groupBys: Object.fromEntries(config.groupBys.map((g) => [g.key, g.label])),
    or: t('or'),
  };
  const facets = facetsOf(state, facetLabels);

  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className={`mt-4 ${pending ? 'opacity-70' : ''}`} aria-busy={pending}>
      <div className="flex flex-wrap items-start gap-2">
        {toolbar}
        <SearchBar
          state={state}
          facets={facets}
          config={config}
          favorites={favorites}
          setFavorites={setFavorites}
          go={go}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-text-muted" aria-live="polite">
          {data.groups
            ? t('grouped', { count: data.total, groups: data.groups.length })
            : t('range', { from, to, total: data.total })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu config={config} columns={visible} state={state} selected={selected} />
          <ColumnChooser columns={config.columns} visible={visible} onChange={saveColumns} />
          {!data.groups && pages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={btn}
                disabled={data.page <= 1}
                onClick={() => go({ ...state, page: data.page - 1 })}
                aria-label={t('previousPage')}
              >
                <span aria-hidden className="rtl:rotate-180">
                  ‹
                </span>
              </button>
              <button
                type="button"
                className={btn}
                disabled={data.page >= pages}
                onClick={() => go({ ...state, page: data.page + 1 })}
                aria-label={t('nextPage')}
              >
                <span aria-hidden className="rtl:rotate-180">
                  ›
                </span>
              </button>
            </div>
          )}
          <label className="flex items-center gap-1 text-caption text-text-muted">
            {t('perPage')}
            <select
              value={state.pageSize}
              onChange={(e) => go({ ...state, page: 1, pageSize: Number(e.target.value) })}
              className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
            >
              {LIST_PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {data.total === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-body font-bold">{t('emptyTitle')}</p>
          <p className="mt-1 text-body-sm text-text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <>
          {/* Phones: cards */}
          <div className="mt-3 space-y-2 md:hidden">
            {data.groups ? (
              <GroupList
                groups={data.groups}
                levels={state.groupBy}
                path={[]}
                config={config}
                columns={visible}
                state={state}
                groupRows={groupRows}
                setGroupRows={setGroupRows}
                selected={selected}
                toggle={toggle}
                rememberNav={rememberNav}
                cards
              />
            ) : (
              data.rows.map((r) => (
                <RowCard
                  key={r.id}
                  row={r}
                  config={config}
                  columns={visible}
                  selected={selected.has(r.id)}
                  toggle={toggle}
                  onOpen={() => rememberNav(data.rows)}
                />
              ))
            )}
            <TotalsCard data={data} columns={visible} />
          </div>

          {/* Wider screens: the table */}
          <div className="mt-3 hidden overflow-x-auto rounded-lg border border-line bg-surface shadow-sm md:block">
            <table className="w-full text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      checked={allOn}
                      disabled={shown.length === 0}
                      onChange={() =>
                        setSelected(allOn ? new Set() : new Set(shown.map((r) => r.id)))
                      }
                      className="h-4 w-4"
                    />
                  </th>
                  {visible.map((c) => {
                    const right = c.kind === 'money' || c.kind === 'number';
                    const active = c.sort && state.sort === c.sort;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={active ? (state.desc ? 'descending' : 'ascending') : undefined}
                        className={`whitespace-nowrap px-3 py-2 text-label uppercase text-text-muted ${right ? 'text-end' : 'text-start'}`}
                      >
                        {c.sort ? (
                          <button
                            type="button"
                            onClick={() => go(sortBy(state, c.sort!))}
                            className="inline-flex items-center gap-1 uppercase hover:text-text"
                          >
                            {c.label}
                            <span aria-hidden>{active ? (state.desc ? '▼' : '▲') : ''}</span>
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.groups ? (
                  <GroupList
                    groups={data.groups}
                    levels={state.groupBy}
                    path={[]}
                    config={config}
                    columns={visible}
                    state={state}
                    groupRows={groupRows}
                    setGroupRows={setGroupRows}
                    selected={selected}
                    toggle={toggle}
                    rememberNav={rememberNav}
                  />
                ) : (
                  data.rows.map((r) => (
                    <TableRow
                      key={r.id}
                      row={r}
                      config={config}
                      columns={visible}
                      selected={selected.has(r.id)}
                      toggle={toggle}
                      onOpen={() => rememberNav(data.rows)}
                    />
                  ))
                )}
              </tbody>
              <tfoot className="border-t-2 border-line bg-surface-raised font-bold">
                <tr>
                  <td className="px-3 py-2" />
                  {visible.map((c, i) => (
                    <td key={c.key} className={`px-3 py-2 ${c.kind === 'money' ? 'text-end' : ''}`}>
                      {c.kind === 'money' && c.key in data.totals ? (
                        <Money value={data.totals[c.key]!} />
                      ) : i === 0 ? (
                        t('total')
                      ) : null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {selected.size > 0 && (
        <BulkBar
          config={config}
          ids={[...selected]}
          clear={() => setSelected(new Set())}
          locale={locale}
          onResult={setBulkResult}
        />
      )}
      {bulkResult && <BulkResult result={bulkResult} close={() => setBulkResult(null)} />}
    </div>
  );
}

function BulkResult({
  result,
  close,
}: {
  result: { ok: number; refused: BulkOutcome[] };
  close: () => void;
}) {
  const t = useTranslations('listView');
  const tErr = useTranslations('finance.merchants.errors');
  const reason = (code?: string) =>
    code && tErr.has(code)
      ? tErr(code)
      : code && t.has(`errors.${code}`)
        ? t(`errors.${code}`)
        : (code ?? '');
  return (
    <div
      role="status"
      className={`mt-4 flex items-start gap-3 rounded-lg border bg-surface p-3 text-body-sm ${result.refused.length ? 'border-status-needs-action' : 'border-line'}`}
    >
      <div className="flex-1">
        <p className="font-bold">
          {t('bulkDone', { ok: result.ok, refused: result.refused.length })}
        </p>
        {result.refused.length > 0 && (
          <ul className="mt-1 list-disc ps-5 text-caption">
            {[...new Set(result.refused.map((r) => r.error))].map((code) => (
              <li key={code}>
                {reason(code)} ({result.refused.filter((r) => r.error === code).length})
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={t('close')}
        className="h-8 w-8 rounded-md hover:bg-surface-raised"
      >
        ×
      </button>
    </div>
  );
}

// ─── the search bar ─────────────────────────────────────────────────────────────

function SearchBar({
  state,
  facets,
  config,
  favorites,
  setFavorites,
  go,
}: {
  state: ListState;
  facets: ReturnType<typeof facetsOf>;
  config: ListViewConfig;
  favorites: Favorite[];
  setFavorites: (f: Favorite[]) => void;
  go: (s: ListState) => void;
}) {
  const t = useTranslations('listView');
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const groups = [...new Set(config.filters.map((f) => f.group))];
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const save = async () => {
    const r = await apiSend<Favorite>('POST', '/me/list-favorites', {
      listKey: config.listId,
      name: name.trim(),
      query: serializeListState({ ...state, page: 1 }),
      isDefault,
    });
    if (!r.ok) return;
    setFavorites([
      ...favorites
        .filter((f) => f.name !== r.data.name)
        .map((f) => (isDefault ? { ...f, isDefault: false } : f)),
      r.data,
    ]);
    setName('');
    setIsDefault(false);
  };
  const remove = async (id: string) => {
    const r = await apiSend('DELETE', `/me/list-favorites/${id}`);
    if (r.ok) setFavorites(favorites.filter((f) => f.id !== id));
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1 basis-[320px]">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1 focus-within:border-focus">
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="text-text-muted"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
        {facets.map((f) => (
          <span
            key={f.id}
            className="inline-flex max-w-full items-center gap-1 rounded-pill bg-selected-bg py-0.5 pe-1 ps-2.5 text-caption font-semibold text-link"
          >
            <span className="text-text-muted">
              {f.kind === 'search'
                ? t('searchFacet')
                : f.kind === 'group'
                  ? t('groupFacet')
                  : t('filterFacet')}
            </span>
            <span className="truncate">{f.values.join(f.joiner)}</span>
            <button
              type="button"
              onClick={() => go(f.without)}
              aria-label={t('removeFacet', { name: f.values.join(f.joiner) })}
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go({ ...state, q: text, page: 1 });
              setText('');
            } else if (e.key === 'Backspace' && text === '' && facets.length) {
              go(facets[facets.length - 1]!.without);
            }
          }}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="h-9 min-w-[8rem] flex-1 bg-transparent text-body-sm outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex h-9 items-center gap-1 rounded-md px-2 text-body-sm font-semibold text-text-muted hover:bg-surface-raised hover:text-text"
        >
          <FilterIcon />
          <span className="max-sm:sr-only">{t('filtersAndGroups')}</span>
        </button>
      </div>
      {open && (
        <div className={`${menuPanel} inset-x-0 grid gap-4 p-3 sm:grid-cols-3`}>
          <section aria-label={t('filters')}>
            <h3 className="px-2 text-label uppercase text-text-muted">{t('filters')}</h3>
            {groups.map((g, gi) => (
              <ul key={g} className={gi > 0 ? 'mt-1 border-t border-line pt-1' : 'mt-1'}>
                {config.filters
                  .filter((f) => f.group === g)
                  .map((f) => (
                    <li key={f.key}>
                      <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={state.filters.includes(f.key)}
                        onClick={() => go(toggleFilter(state, f.key))}
                        className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-body-sm hover:bg-surface-raised"
                      >
                        <span aria-hidden className="w-4 text-link">
                          {state.filters.includes(f.key) ? '✓' : ''}
                        </span>
                        {f.label}
                      </button>
                    </li>
                  ))}
              </ul>
            ))}
          </section>
          <section aria-label={t('groupBy')}>
            <h3 className="px-2 text-label uppercase text-text-muted">{t('groupBy')}</h3>
            <ul className="mt-1">
              {config.groupBys.map((g) => {
                const at = state.groupBy.indexOf(g.key);
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={at >= 0}
                      onClick={() => go(toggleGroupBy(state, g.key))}
                      className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-start text-body-sm hover:bg-surface-raised"
                    >
                      <span aria-hidden className="ltr-iso w-4 text-link">
                        {at >= 0 ? at + 1 : ''}
                      </span>
                      {g.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 px-2 text-caption text-text-muted">{t('groupHint')}</p>
          </section>
          <section aria-label={t('favorites')}>
            <h3 className="px-2 text-label uppercase text-text-muted">{t('favorites')}</h3>
            <ul className="mt-1">
              {favorites.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => go(parseListState(new URLSearchParams(f.query)))}
                    className="flex min-h-10 flex-1 items-center gap-2 rounded-md px-2 text-start text-body-sm hover:bg-surface-raised"
                  >
                    <span aria-hidden className="w-4 text-link">
                      {f.isDefault ? '★' : '☆'}
                    </span>
                    {f.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(f.id)}
                    aria-label={t('deleteFavorite', { name: f.name })}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-danger"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 space-y-2 border-t border-line px-2 pt-2">
              <label className="block text-caption text-text-muted">
                {t('saveSearch')}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  className="mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm text-text"
                />
              </label>
              <label className="flex items-center gap-2 text-caption">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-4 w-4"
                />
                {t('useByDefault')}
              </label>
              <button
                type="button"
                className={btn}
                disabled={!name.trim()}
                onClick={() => void save()}
              >
                {t('save')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ─── cells, rows and groups ─────────────────────────────────────────────────────

function Money({ value }: { value: number }) {
  const v = value === 0 ? 0 : value;
  return <span className={`ltr-iso ${v < 0 ? 'text-danger' : ''}`}>{formatEgp(v)}</span>;
}

function Cell({
  config,
  column,
  row,
}: {
  config: ListViewConfig;
  column: ListColumn;
  row: ListRow;
}) {
  const locale = useLocale();
  const t = useTranslations('listView');
  const v = row[column.key];
  if (v === null || v === undefined || v === '') return <span className="text-text-muted">–</span>;
  switch (column.kind) {
    case 'money':
      return typeof v === 'number' ? <Money value={v} /> : null;
    case 'number':
      return <span className="ltr-iso">{String(v)}</span>;
    case 'date':
      return (
        <span className="ltr-iso whitespace-nowrap">{isoToDayFirst(String(v).slice(0, 10))}</span>
      );
    case 'datetime':
      return (
        <span className="ltr-iso whitespace-nowrap">{formatCairoDateTime(String(v), locale)}</span>
      );
    case 'bool':
      return <span>{v ? t('yes') : t('no')}</span>;
    case 'status':
      return (
        <span className="inline-block whitespace-nowrap rounded-pill border border-line px-2.5 py-0.5 text-caption">
          {labelOf(config, column.key, v)}
        </span>
      );
    case 'ltr':
      return <span className="ltr-iso whitespace-nowrap">{labelOf(config, column.key, v)}</span>;
    default:
      return <span>{labelOf(config, column.key, v)}</span>;
  }
}

function TableRow({
  row,
  config,
  columns,
  selected,
  toggle,
  onOpen,
}: {
  row: ListRow;
  config: ListViewConfig;
  columns: ListColumn[];
  selected: boolean;
  toggle: (id: string) => void;
  onOpen: () => void;
}) {
  const t = useTranslations('listView');
  const href = rowHrefOf(config.rowHref, row);
  return (
    <tr
      className={`border-b border-line last:border-0 ${selected ? 'bg-selected-bg' : 'hover:bg-surface-raised'}`}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggle(row.id)}
          aria-label={t('selectRow')}
          className="h-4 w-4"
        />
      </td>
      {columns.map((c, i) => (
        <td
          key={c.key}
          className={`px-3 py-2 align-top ${c.kind === 'money' || c.kind === 'number' ? 'text-end' : ''} ${i === 0 ? 'font-bold' : ''}`}
        >
          {i === 0 && href ? (
            <Link href={href} onClick={onOpen} className="text-link">
              <Cell config={config} column={c} row={row} />
            </Link>
          ) : (
            <Cell config={config} column={c} row={row} />
          )}
        </td>
      ))}
    </tr>
  );
}

function RowCard({
  row,
  config,
  columns,
  selected,
  toggle,
  onOpen,
}: {
  row: ListRow;
  config: ListViewConfig;
  columns: ListColumn[];
  selected: boolean;
  toggle: (id: string) => void;
  onOpen: () => void;
}) {
  const t = useTranslations('listView');
  const href = rowHrefOf(config.rowHref, row);
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const status = columns.find((c) => c.kind === 'status');
  const money = columns.filter((c) => c.kind === 'money');
  const rest = columns.filter((c) => c !== primary && c !== status && c.kind !== 'money');
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-bold text-link">
          {primary && <Cell config={config} column={primary} row={row} />}
        </p>
        {status && <Cell config={config} column={status} row={row} />}
      </div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-caption">
        {rest.slice(0, 4).map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="text-text-muted">{c.label}</dt>
            <dd className="truncate">
              <Cell config={config} column={c} row={row} />
            </dd>
          </div>
        ))}
      </dl>
      {money.length > 0 && (
        <p className="mt-1 text-end text-body font-bold">
          <Cell config={config} column={money[0]!} row={row} />
        </p>
      )}
    </>
  );
  return (
    <div
      className={`flex gap-2 rounded-lg border border-line p-3 ${selected ? 'bg-selected-bg' : 'bg-surface'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => toggle(row.id)}
        aria-label={t('selectRow')}
        className="mt-1 h-5 w-5 shrink-0"
      />
      {href ? (
        <Link href={href} onClick={onOpen} className="block min-w-0 flex-1">
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
    </div>
  );
}

function TotalsCard({ data, columns }: { data: ListData; columns: ListColumn[] }) {
  const t = useTranslations('listView');
  const money = columns.filter((c) => c.kind === 'money' && c.key in data.totals);
  if (!money.length) return null;
  return (
    <dl className="rounded-lg border-2 border-line bg-surface-raised p-3 text-body-sm">
      {money.map((c) => (
        <div key={c.key} className="flex justify-between gap-2">
          <dt className="font-bold">
            {t('total')} · {c.label}
          </dt>
          <dd className="font-bold">
            <Money value={data.totals[c.key]!} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function GroupList({
  groups,
  levels,
  path,
  config,
  columns,
  state,
  groupRows,
  setGroupRows,
  selected,
  toggle,
  rememberNav,
  cards = false,
}: {
  groups: ListGroup[];
  levels: string[];
  path: string[];
  config: ListViewConfig;
  columns: ListColumn[];
  state: ListState;
  groupRows: Record<string, ListRow[]>;
  setGroupRows: (fn: (r: Record<string, ListRow[]>) => Record<string, ListRow[]>) => void;
  selected: Set<string>;
  toggle: (id: string) => void;
  rememberNav: (rows: ListRow[]) => void;
  cards?: boolean;
}) {
  const t = useTranslations('listView');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const level = levels[path.length] ?? '';
  const depth = path.length;

  const expand = async (g: ListGroup) => {
    const id = [...path, g.key].join('\n');
    const now = !open[id];
    setOpen((o) => ({ ...o, [id]: now }));
    if (!now || g.groups || groupRows[id]) return;
    setLoading(id);
    const query = `${serializeListState({ ...state, page: 1, pageSize: 200 })}&open=${encodeURIComponent(id)}`;
    const r = await apiGetClient<ListData>(`${config.endpoint}?${query}`);
    setLoading(null);
    if (r.ok) setGroupRows((rows) => ({ ...rows, [id]: r.data.rows }));
  };

  return (
    <>
      {groups.map((g) => {
        const id = [...path, g.key].join('\n');
        const isOpen = !!open[id];
        const label = labelOf(config, level, g.label === '-' ? '' : g.label) || t('none');
        const header = (
          <button
            type="button"
            onClick={() => void expand(g)}
            aria-expanded={isOpen}
            className="flex w-full min-w-0 flex-1 items-center gap-2 text-start font-bold"
            style={{ paddingInlineStart: `${depth * 20}px` }}
          >
            <Chevron open={isOpen} />
            <span className="min-w-0 truncate">{label}</span>
            <span className="ltr-iso rounded-pill bg-surface px-2 text-caption text-text-muted">
              {g.count}
            </span>
            {loading === id && <span className="text-caption text-text-muted">{t('loading')}</span>}
          </button>
        );
        const rows = groupRows[id] ?? [];
        if (cards)
          return (
            <div key={id} className="space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-md bg-surface-raised px-3 py-2">
                {header}
                <span className="shrink-0 text-body-sm font-bold">
                  {columns
                    .filter((c) => c.kind === 'money' && c.key in g.totals)
                    .slice(0, 1)
                    .map((c) => (
                      <Money key={c.key} value={g.totals[c.key]!} />
                    ))}
                </span>
              </div>
              {isOpen &&
                (g.groups ? (
                  <GroupList
                    {...{
                      groups: g.groups,
                      levels,
                      path: [...path, g.key],
                      config,
                      columns,
                      state,
                      groupRows,
                      setGroupRows,
                      selected,
                      toggle,
                      rememberNav,
                      cards,
                    }}
                  />
                ) : (
                  rows.map((r) => (
                    <RowCard
                      key={r.id}
                      row={r}
                      config={config}
                      columns={columns}
                      selected={selected.has(r.id)}
                      toggle={toggle}
                      onOpen={() => rememberNav(rows)}
                    />
                  ))
                ))}
            </div>
          );
        return (
          <GroupRows key={id}>
            <tr className="border-b border-line bg-surface-raised">
              <td className="px-3 py-2" />
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${c.kind === 'money' ? 'text-end font-bold' : ''}`}
                >
                  {i === 0 ? (
                    header
                  ) : c.kind === 'money' && c.key in g.totals ? (
                    <Money value={g.totals[c.key]!} />
                  ) : null}
                </td>
              ))}
            </tr>
            {isOpen &&
              (g.groups ? (
                <GroupList
                  {...{
                    groups: g.groups,
                    levels,
                    path: [...path, g.key],
                    config,
                    columns,
                    state,
                    groupRows,
                    setGroupRows,
                    selected,
                    toggle,
                    rememberNav,
                  }}
                />
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    row={r}
                    config={config}
                    columns={columns}
                    selected={selected.has(r.id)}
                    toggle={toggle}
                    onOpen={() => rememberNav(rows)}
                  />
                ))
              ))}
          </GroupRows>
        );
      })}
    </>
  );
}

function GroupRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ─── columns, exports and bulk actions ─────────────────────────────────────────

function ColumnChooser({
  columns,
  visible,
  onChange,
}: {
  columns: ListColumn[];
  visible: ListColumn[];
  onChange: (keys: string[]) => void;
}) {
  const t = useTranslations('listView');
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const on = new Set(visible.map((c) => c.key));
  return (
    <div ref={ref} className="relative">
      <button type="button" className={btn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t('columns')}
      </button>
      {open && (
        <ul className={`${menuPanel} end-0 w-64`}>
          {columns.map((c) => (
            <li key={c.key}>
              <label className="flex min-h-10 items-center gap-2 rounded-md px-2 text-body-sm hover:bg-surface-raised">
                <input
                  type="checkbox"
                  checked={on.has(c.key)}
                  disabled={c.primary}
                  onChange={() =>
                    onChange(
                      columns
                        .filter((x) => (x.key === c.key ? !on.has(c.key) : on.has(x.key)))
                        .map((x) => x.key),
                    )
                  }
                  className="h-4 w-4"
                />
                {c.label}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportMenu({
  config,
  columns,
  state,
  selected,
}: {
  config: ListViewConfig;
  columns: ListColumn[];
  state: ListState;
  selected: Set<string>;
}) {
  const t = useTranslations('listView');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const run = async (format: 'csv' | 'xlsx') => {
    setBusy(true);
    const r = await apiGetClient<ListData>(`${config.endpoint}?${serializeListState(state)}&all=1`);
    setBusy(false);
    setOpen(false);
    if (!r.ok) return;
    // Selected rows only when some are ticked, like Odoo.
    const rows = selected.size ? r.data.rows.filter((x) => selected.has(x.id)) : r.data.rows;
    const table = exportTable(config, columns, rows, { yes: t('yes'), no: t('no') });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv')
      download(
        `${config.exportName}-${stamp}.csv`,
        new Blob([exportCsv(table.header, table.rows)], { type: 'text/csv;charset=utf-8' }),
      );
    else
      download(
        `${config.exportName}-${stamp}.xlsx`,
        new Blob(
          [
            exportXlsx(table.header, table.rows, {
              sheetName: config.exportName,
              rtl: locale === 'ar',
            }) as BlobPart,
          ],
          {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ),
      );
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={btn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={busy}
      >
        {busy ? t('loading') : t('export')}
      </button>
      {open && (
        <ul className={`${menuPanel} end-0 w-56`}>
          <li>
            <button
              type="button"
              onClick={() => void run('csv')}
              className="flex min-h-10 w-full items-center rounded-md px-2 text-start text-body-sm hover:bg-surface-raised"
            >
              {t('exportCsv')}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => void run('xlsx')}
              className="flex min-h-10 w-full items-center rounded-md px-2 text-start text-body-sm hover:bg-surface-raised"
            >
              {t('exportXlsx')}
            </button>
          </li>
          {selected.size > 0 && (
            <li className="px-2 pt-1 text-caption text-text-muted">
              {t('exportSelected', { count: selected.size })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function BulkBar({
  config,
  ids,
  clear,
  locale,
  onResult,
}: {
  config: ListViewConfig;
  ids: string[];
  clear: () => void;
  locale: string;
  onResult: (r: { ok: number; refused: BulkOutcome[] }) => void;
}) {
  const t = useTranslations('listView');
  const router = useRouter();
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const setResult = onResult;
  const current = config.bulkActions?.find((a) => a.key === action) ?? null;

  const run = async (a: NonNullable<ListViewConfig['bulkActions']>[number]) => {
    if (a.note === 'required' && !note.trim()) {
      setAction(a.key);
      return;
    }
    setBusy(true);
    const r = await apiSend<{ results: BulkOutcome[] }>('POST', a.endpoint, {
      ids,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...a.body,
    });
    setBusy(false);
    if (!r.ok) {
      setResult({ ok: 0, refused: ids.map((id) => ({ id, ok: false, error: r.error })) });
      return;
    }
    setResult({
      ok: r.data.results.filter((x) => x.ok).length,
      refused: r.data.results.filter((x) => !x.ok),
    });
    setAction(null);
    setNote('');
    router.refresh();
  };

  return (
    <div
      role="region"
      aria-label={t('bulkBar')}
      lang={locale}
      className="sticky bottom-2 z-30 mt-4 rounded-lg border border-line bg-hero p-3 text-hero-ink shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto text-body-sm font-bold">{t('selected', { count: ids.length })}</p>
        {config.bulkActions?.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={busy}
            onClick={() => void run(a)}
            className={`h-10 rounded-md px-4 text-body-sm font-bold disabled:opacity-60 ${
              a.tone === 'danger'
                ? 'border border-hero-ink bg-transparent text-hero-ink'
                : 'bg-primary text-on-primary'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={clear}
          className="h-10 rounded-md px-3 text-body-sm font-semibold underline"
        >
          {t('clearSelection')}
        </button>
      </div>
      {(current?.note || config.bulkActions?.some((a) => a.note === 'optional')) && (
        <label className="mt-2 block text-caption">
          {current?.note === 'required' ? t('noteRequired') : t('noteOptional')}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            className="mt-1 block h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm text-text"
          />
        </label>
      )}
    </div>
  );
}
