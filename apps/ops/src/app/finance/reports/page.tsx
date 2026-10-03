'use client';

import { Button, Card, ErrorBox, formatDateTime, inputClass, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import { useEffect, useState } from 'react';

type Kind = 'trial_balance' | 'income_statement' | 'balance_sheet' | 'cash_flow' | 'daily_cod' | 'merchant_profitability';
interface Column { key: string; label: string; type: 'text' | 'money' | 'int' }
interface Report { title: string; period: string; columns: Column[]; rows: ({ style?: string } & Record<string, string | number | null>)[]; checks: { label: string; ok: boolean }[] }
interface ExportRow { id: string; kind: string; format: string; status: string; fileName: string | null; createdAt: string; error: string | null }


const today = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const { api, t, lang } = useApp();
  const KINDS: { kind: Kind; label: string; pointInTime: boolean }[] = [
    { kind: 'trial_balance', label: t.rTrialBalance, pointInTime: true },
    { kind: 'income_statement', label: t.rIncome, pointInTime: false },
    { kind: 'balance_sheet', label: t.rBalanceSheet, pointInTime: true },
    { kind: 'cash_flow', label: t.rCashFlow, pointInTime: false },
    { kind: 'daily_cod', label: t.rDailyCod, pointInTime: false },
    { kind: 'merchant_profitability', label: t.rProfitability, pointInTime: false },
  ];
  const [kind, setKind] = useState<Kind>('trial_balance');
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today(), asOf: today() });
  const meta = KINDS.find((k) => k.kind === kind)!;
  const params: Record<string, string> = meta.pointInTime ? { asOf: range.asOf, lang } : { from: range.from, to: range.to, lang };
  const qs = new URLSearchParams(params).toString();
  const report = useAsync(() => api.get<Report>(`/finance/reports/${kind}?${qs}`), [kind, qs]);
  const exportsList = useAsync(() => api.get<ExportRow[]>('/finance/exports'), []);
  const [exportError, setExportError] = useState<unknown>(null);

  // Poll while an export is still being generated in the background.
  const busy = (exportsList.data ?? []).some((e) => e.status === 'QUEUED' || e.status === 'RUNNING');
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(() => exportsList.reload(), 1500);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  async function requestExport(format: 'xlsx' | 'pdf') {
    setExportError(null);
    try {
      await api.post('/finance/exports', { kind, format, params });
      exportsList.reload();
    } catch (e) {
      setExportError(e);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.reports} subtitle={t.reportsSubtitle} />
      <div className="flex flex-wrap gap-2" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            role="tab"
            aria-selected={kind === k.kind}
            onClick={() => setKind(k.kind)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${kind === k.kind ? 'bg-ink text-white' : 'text-muted ring-1 ring-inset ring-line hover:bg-surface'}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <Card
        title={report.data ? `${report.data.title} · ${report.data.period}` : meta.label}
        actions={
          <>
            {meta.pointInTime ? (
              <input type="date" className={`${inputClass} w-auto py-1.5`} value={range.asOf} onChange={(e) => setRange({ ...range, asOf: e.target.value })} aria-label={t.asOf} />
            ) : (
              <>
                <input type="date" className={`${inputClass} w-auto py-1.5`} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label={t.from} />
                <input type="date" className={`${inputClass} w-auto py-1.5`} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label={t.to} />
              </>
            )}
            <Button variant="secondary" onClick={() => requestExport('xlsx')}>{t.exportExcel}</Button>
            <Button variant="secondary" onClick={() => requestExport('pdf')}>{t.exportPdf}</Button>
          </>
        }
        flush
      >
        <ErrorBox error={exportError} />
        {report.loading && !report.data ? (
          <Spinner />
        ) : report.error ? (
          <div className="p-5"><ErrorBox error={report.error} /></div>
        ) : (
          report.data && (
            <>
              {report.data.checks.length > 0 && (
                <div className="flex flex-wrap gap-2 px-5 pb-1">
                  {report.data.checks.map((c) => (
                    <span key={c.label} className={`rounded-md px-2 py-0.5 text-xs font-medium ${c.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`} data-testid="report-check">
                      {c.ok ? '✓' : '✕'} {c.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm" data-testid="report-table">
                  <thead className="text-[11px] uppercase tracking-wider text-muted">
                    <tr className="border-b border-line">
                      {report.data.columns.map((c) => (
                        <th key={c.key} className={`px-5 py-2 font-medium ${c.type === 'text' ? 'text-start' : 'text-end'}`}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.rows.map((r, i) => (
                      <tr
                        key={i}
                        className={
                          r.style === 'section'
                            ? 'bg-paper text-[11px] font-semibold uppercase tracking-wider text-muted'
                            : r.style === 'total'
                              ? 'border-t-2 border-text font-semibold'
                              : r.style === 'subtotal'
                                ? 'border-t border-line font-medium'
                                : 'border-t border-line/60'
                        }
                      >
                        {report.data!.columns.map((c) => {
                          const v = r[c.key];
                          return (
                            <td key={c.key} className={`px-5 py-2 ${c.type === 'text' ? 'text-start' : 'text-end tabular'}`}>
                              {v === null || v === undefined || v === '' ? '' : c.type === 'money' ? <Money value={Number(v)} className={Number(v) < 0 ? 'text-rose-700' : ''} /> : String(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </Card>

      <Card title={t.exportsList}>
        {(exportsList.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t.none}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="exports-list">
            {exportsList.data!.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{KINDS.find((k) => k.kind === e.kind)?.label ?? e.kind} <span className="text-xs uppercase text-muted">{e.format}</span></div>
                  <div className="text-xs text-muted">{formatDateTime(e.createdAt, lang)}{e.error ? ` · ${e.error}` : ''}</div>
                </div>
                {e.status === 'DONE' ? (
                  <Button variant="secondary" onClick={() => api.download(`/finance/exports/${e.id}/download`, e.fileName ?? `report.${e.format}`)}>{t.download}</Button>
                ) : (
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${e.status === 'FAILED' ? 'bg-rose-50 text-rose-800' : 'bg-sky-50 text-sky-800'}`}>{e.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
