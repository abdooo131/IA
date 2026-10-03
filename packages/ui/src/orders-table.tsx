'use client';

import { ORDER_STATUSES, OrderStatus, STATUS_GROUPS } from '@shiply/shared';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './app-context';
import { Button, ErrorBox, inputClass, Money, Spinner, StatusBadge, useAsync, formatDateTime } from './components';
import { GROUP_LABELS, STATUS_LABELS } from './i18n';

export interface OrderRow {
  id: string;
  trackingNumber: string;
  merchantReference: string | null;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  governorateCode: string;
  area: string;
  codAmount: number;
  totalFees: number;
  printCount: number;
  needsManualHub: boolean;
  createdAt: string;
  destinationHub: { code: string } | null;
  merchant?: { nameEn: string; nameAr: string; code: string };
}

interface Props {
  /** Builds the link to an order detail page. */
  Link: React.ComponentType<{ href: string; className?: string; children: React.ReactNode }>;
  initialQuery: Record<string, string>;
  onQueryChange: (q: Record<string, string>) => void;
  showMerchant?: boolean;
  merchants?: { id: string; nameEn: string; nameAr: string }[];
}

const FILTER_KEYS = ['q', 'status', 'group', 'printed', 'governorateCode', 'from', 'to', 'merchantId', 'needsManualHub'];

/** Orders table with filters, pagination, selection and bulk AWB printing. Used by the merchant portal and ops. */
export function OrdersTable({ Link, initialQuery, onQueryChange, showMerchant, merchants }: Props) {
  const { api, t, lang } = useApp();
  const [query, setQuery] = useState<Record<string, string>>(initialQuery);
  const [draft, setDraft] = useState<Record<string, string>>(initialQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printError, setPrintError] = useState<unknown>(null);
  const govs = useAsync(() => api.get<{ code: string; nameEn: string; nameAr: string }[]>('/reference/governorates'), []);

  useEffect(() => {
    setQuery(initialQuery);
    setDraft(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialQuery)]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    if (!p.get('pageSize')) p.set('pageSize', '25');
    return p.toString();
  }, [query]);

  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; page: number; pageSize: number; items: OrderRow[] }>(`/orders?${qs}`),
    [qs],
  );

  function apply(next: Record<string, string>) {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
    setQuery(clean);
    setSelected(new Set());
    onQueryChange(clean);
  }

  async function print(ids: string[]) {
    setPrintError(null);
    try {
      await api.openBlob('/orders/labels', { method: 'POST', body: JSON.stringify({ ids }), headers: { 'Content-Type': 'application/json' } });
      setSelected(new Set());
      reload();
    } catch (e) {
      setPrintError(e);
    }
  }

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));
  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <form
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ ...draft, page: '' });
        }}
      >
        <input className={`${inputClass} lg:col-span-2`} placeholder={t.search} value={draft.q ?? ''} onChange={(e) => setDraft({ ...draft, q: e.target.value })} name="q" />
        <select className={inputClass} value={draft.group ?? ''} onChange={(e) => setDraft({ ...draft, group: e.target.value, status: '' })} aria-label="group">
          <option value="">{t.allGroups}</option>
          {STATUS_GROUPS.map((g) => (
            <option key={g} value={g}>{GROUP_LABELS[lang][g]}</option>
          ))}
        </select>
        <select className={inputClass} value={draft.status ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value, group: '' })} aria-label="status">
          <option value="">{t.allStatuses}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[lang][s]}</option>
          ))}
        </select>
        <select className={inputClass} value={draft.printed ?? ''} onChange={(e) => setDraft({ ...draft, printed: e.target.value })} aria-label="printed">
          <option value="">{t.printed}: {t.any}</option>
          <option value="true">{t.printed}</option>
          <option value="false">{t.notPrinted}</option>
        </select>
        <select className={inputClass} value={draft.governorateCode ?? ''} onChange={(e) => setDraft({ ...draft, governorateCode: e.target.value })} aria-label="governorate">
          <option value="">{t.governorate}: {t.any}</option>
          {(govs.data ?? []).map((g) => (
            <option key={g.code} value={g.code}>{lang === 'ar' ? g.nameAr : g.nameEn}</option>
          ))}
        </select>
        {showMerchant && (
          <select className={inputClass} value={draft.merchantId ?? ''} onChange={(e) => setDraft({ ...draft, merchantId: e.target.value })} aria-label="merchant">
            <option value="">{t.allMerchants}</option>
            {(merchants ?? []).map((m) => (
              <option key={m.id} value={m.id}>{lang === 'ar' ? m.nameAr : m.nameEn}</option>
            ))}
          </select>
        )}
        <div className="flex min-w-0 gap-2">
          <input className={`${inputClass} min-w-0`} type="date" value={draft.from ?? ''} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label={t.from} title={t.from} />
          <input className={`${inputClass} min-w-0`} type="date" value={draft.to ?? ''} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label={t.to} title={t.to} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">{t.filter}</Button>
          <Button type="button" variant="secondary" onClick={() => { setDraft({}); apply({}); }}>{t.reset}</Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={selected.size === 0} onClick={() => print([...selected])} data-testid="print-selected">
          {t.printSelected} ({selected.size})
        </Button>
        {data && <span className="text-sm text-slate-500">{data.total} {t.orders}</span>}
      </div>
      <ErrorBox error={printError} />

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="orders-table">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">
                  <input type="checkbox" aria-label="select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id)))} />
                </th>
                <th className="px-3 py-2 text-start">{t.tracking}</th>
                {showMerchant && <th className="px-3 py-2 text-start">{t.merchant}</th>}
                <th className="px-3 py-2 text-start">{t.customer}</th>
                <th className="px-3 py-2 text-start">{t.area}</th>
                <th className="px-3 py-2 text-start">{t.status}</th>
                <th className="px-3 py-2 text-end">{t.cod}</th>
                <th className="px-3 py-2 text-end">{t.fees}</th>
                <th className="px-3 py-2 text-start">{t.hub}</th>
                <th className="px-3 py-2 text-start">{t.created}</th>
                <th className="px-3 py-2 text-start">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-500">{t.noOrders}</td>
                </tr>
              )}
              {items.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50" data-tracking={o.trackingNumber}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`select ${o.trackingNumber}`}
                      checked={selected.has(o.id)}
                      onChange={() => {
                        const n = new Set(selected);
                        if (n.has(o.id)) n.delete(o.id);
                        else n.add(o.id);
                        setSelected(n);
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <Link href={`/orders/${o.id}`} className="text-teal-800 hover:underline">{o.trackingNumber}</Link>
                    {o.merchantReference && <div className="text-xs text-slate-500">{o.merchantReference}</div>}
                  </td>
                  {showMerchant && <td className="px-3 py-2">{lang === 'ar' ? o.merchant?.nameAr : o.merchant?.nameEn}</td>}
                  <td className="px-3 py-2">
                    <div>{o.customerName}</div>
                    <div className="text-xs text-slate-500" dir="ltr">{o.customerPhone}</div>
                  </td>
                  <td className="px-3 py-2">
                    {o.area} <span className="text-xs text-slate-500">({o.governorateCode})</span>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={o.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-end"><Money value={o.codAmount} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-end"><Money value={o.totalFees} /></td>
                  <td className="px-3 py-2">
                    {o.destinationHub?.code ?? (o.needsManualHub ? <span className="text-xs text-orange-700">{t.manualHub}</span> : '-')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{formatDateTime(o.createdAt, lang)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Button variant="ghost" onClick={() => print([o.id])}>
                      {t.printLabel}
                      {o.printCount > 0 && <span className="text-xs text-slate-500">({o.printCount})</span>}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => apply({ ...query, page: String(page - 1) })}>{t.prev}</Button>
          <span>{t.page} {page} {t.of} {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => apply({ ...query, page: String(page + 1) })}>{t.next}</Button>
        </div>
      )}
    </div>
  );
}

export function queryFromSearch(sp: URLSearchParams): Record<string, string> {
  const q: Record<string, string> = {};
  for (const k of [...FILTER_KEYS, 'page']) {
    const v = sp.get(k);
    if (v) q[k] = v;
  }
  return q;
}
