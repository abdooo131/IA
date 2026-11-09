'use client';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { confirm } from './feedback';

export interface Column<T> {
  key: string;
  /** translated header */
  label: string;
  render?: (row: T) => ReactNode;
}
export interface BulkAction {
  label: string;
  danger?: boolean;
  /** translated confirmation text; asked before running when set */
  confirmBody?: string;
  run: (ids: string[]) => Promise<void> | void;
}

/** Every list in the system: title and main button, filters, table, bulk actions, 50 a page. */
export function ListPage<T extends { id: string }>(props: {
  title: string;
  action?: ReactNode;
  filters?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize?: number;
  onPage: (page: number) => void;
  onRowClick?: (row: T) => void;
  bulkActions?: BulkAction[];
  onExport?: () => void;
  loading?: boolean;
}) {
  const t = useTranslations('common');
  const size = props.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(props.total / size));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = props.rows.length > 0 && props.rows.every((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const run = async (a: BulkAction) => {
    if (a.confirmBody && !(await confirm({ title: a.label, body: a.confirmBody, danger: a.danger }))) return;
    await a.run([...picked]);
    setPicked(new Set());
  };
  return (
    <section className="list-page">
      <div className="page-head">
        <h1>{props.title}</h1>
        {props.action}
      </div>
      {(props.filters || props.onExport) && (
        <div className="filters">
          {props.filters}
          {props.onExport && (
            <button className="btn ghost" onClick={props.onExport}>
              {t('export')}
            </button>
          )}
        </div>
      )}
      {picked.size > 0 && props.bulkActions && (
        <div className="bulkbar" data-testid="bulkbar">
          <span>{t('selected', { count: picked.size })}</span>
          {props.bulkActions.map((a) => (
            <button key={a.label} className={`btn ${a.danger ? 'danger' : 'ghost'}`} onClick={() => void run(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {props.bulkActions && (
                <th className="pick">
                  <input
                    type="checkbox"
                    checked={all}
                    aria-label={t('selected', { count: props.rows.length })}
                    onChange={() => setPicked(all ? new Set() : new Set(props.rows.map((r) => r.id)))}
                  />
                </th>
              )}
              {props.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.id} className={props.onRowClick ? 'clickable' : undefined} onClick={() => props.onRowClick?.(r)} data-testid="row">
                {props.bulkActions && (
                  <td className="pick" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.id} />
                  </td>
                )}
                {props.columns.map((c) => (
                  <td key={c.key} data-label={c.label}>
                    {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!props.loading && props.rows.length === 0 && <p className="empty-rows">{t('noResults')}</p>}
      </div>
      <div className="pager">
        <button className="btn ghost" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>
          {t('previous')}
        </button>
        <span data-testid="page-of">{t('page', { page: props.page, pages })}</span>
        <button className="btn ghost" disabled={props.page >= pages} onClick={() => props.onPage(props.page + 1)}>
          {t('next')}
        </button>
        <span className="muted">{t('perPage', { size })}</span>
      </div>
    </section>
  );
}
