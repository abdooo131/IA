'use client';

import { Button, ErrorBox, formatDateTime, inputClass, memoLabel, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import { Fragment, useState } from 'react';

interface Line { id: string; accountCode: string; debit: number; credit: number; memo: string | null; merchantId: string | null }
interface Journal {
  id: string;
  type: string;
  description: string;
  occurredAt: string;
  merchantId: string | null;
  reversesId: string | null;
  reversed: boolean;
  reversible: boolean;
  lines: Line[];
}
interface Account { code: string; nameEn: string; nameAr: string }

const TYPES = ['COD_COLLECTED', 'ORDER_SETTLEMENT', 'FAILED_DELIVERY_FEE', 'CASH_DEPOSIT', 'MERCHANT_CASHOUT', 'MERCHANT_ADJUSTMENT', 'REVERSAL'];

export default function JournalPage() {
  const { api, t, lang, session } = useApp();
  const human = (s: string) => (t as unknown as Record<string, string>)[`j${s}`] ?? s;
  const [filters, setFilters] = useState({ type: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) }).toString();
  const { data, error, loading, reload } = useAsync(() => api.get<{ total: number; pageSize: number; items: Journal[] }>(`/finance/journals?${qs}`), [qs]);
  const accounts = useAsync(() => api.get<Account[]>('/finance/accounts'), []);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<unknown>(null);
  const canWrite = ['SUPER_ADMIN', 'FINANCE'].includes(session?.user.role ?? '');
  const accName = (code: string) => {
    const a = accounts.data?.find((x) => x.code === code);
    return a ? (lang === 'ar' ? a.nameAr : a.nameEn) : code;
  };

  async function reverse(id: string) {
    setActionError(null);
    try {
      await api.post(`/finance/journals/${id}/reverse`, { reason });
      setReversing(null);
      setReason('');
      reload();
    } catch (e) {
      setActionError(e);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader title={t.journal} subtitle={t.journalSubtitle} />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(filters);
        }}
      >
        <select className={`${inputClass} w-auto`} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} aria-label={t.type}>
          <option value="">{t.type}: {t.any}</option>
          {TYPES.map((x) => <option key={x} value={x}>{human(x)}</option>)}
        </select>
        <input className={`${inputClass} w-auto`} type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} aria-label={t.from} />
        <input className={`${inputClass} w-auto`} type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} aria-label={t.to} />
        <Button type="submit">{t.filter}</Button>
      </form>
      <ErrorBox error={actionError} />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="min-w-full text-sm" data-testid="journal-table">
            <thead className="bg-paper text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">#</th>
                <th className="px-3 py-2 text-start font-medium">{t.date}</th>
                <th className="px-3 py-2 text-start font-medium">{t.type}</th>
                <th className="px-3 py-2 text-start font-medium">{t.description}</th>
                <th className="px-3 py-2 text-end font-medium">{t.amount}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data!.items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">{t.none}</td></tr>}
              {data!.items.map((j) => {
                const total = j.lines.reduce((s, l) => s + l.debit, 0);
                const isOpen = open.has(j.id);
                return (
                  <Fragment key={j.id}>
                    <tr className="cursor-pointer hover:bg-paper" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })}>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">{j.id}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{formatDateTime(j.occurredAt, lang)}</td>
                      <td className="px-3 py-2.5"><span className="rounded-md bg-paper px-2 py-0.5 text-xs">{human(j.type)}</span></td>
                      <td className="px-3 py-2.5">
                        {j.description}
                        {j.reversed && <span className="ms-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">{t.reversed}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-end font-medium"><Money value={total} /></td>
                      <td className="px-4 py-2.5 text-end text-xs text-muted">{isOpen ? '▴' : '▾'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-paper/60">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <table className="w-full text-xs">
                            <thead className="text-muted">
                              <tr>
                                <th className="py-1 text-start font-medium">{t.account}</th>
                                <th className="py-1 text-start font-medium">{t.note}</th>
                                <th className="py-1 text-end font-medium">{t.debit}</th>
                                <th className="py-1 text-end font-medium">{t.credit}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {j.lines.map((l) => (
                                <tr key={l.id}>
                                  <td className="py-1"><span className="font-mono text-muted">{l.accountCode}</span> {accName(l.accountCode)}</td>
                                  <td className="py-1 text-muted">{l.memo ? memoLabel(l.memo, t) : ''}</td>
                                  <td className="py-1 text-end">{l.debit ? <Money value={l.debit} /> : ''}</td>
                                  <td className="py-1 text-end">{l.credit ? <Money value={l.credit} /> : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {canWrite && j.reversible && !j.reversed && (
                            reversing === j.id ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <input className={`${inputClass} max-w-xs`} placeholder={t.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
                                <Button variant="danger" disabled={reason.trim().length < 3} onClick={() => reverse(j.id)}>{t.reverse}</Button>
                                <Button variant="secondary" onClick={() => setReversing(null)}>{t.cancel}</Button>
                              </div>
                            ) : (
                              <Button variant="ghost" className="mt-2" onClick={(e) => { e.stopPropagation(); setReversing(j.id); }}>{t.reverse}</Button>
                            )
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.prev}</Button>
          <span className="text-muted">{t.page} {page} {t.of} {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.next}</Button>
        </div>
      )}
    </div>
  );
}
