'use client';

import { Button, Card, ErrorBox, formatDateTime, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useState } from 'react';

interface Overview {
  cashWithDrivers: number;
  fawryReceivable: number;
  bank: number;
  merchantWallets: number;
  codAwaitingSettlement: number;
  vatPayable: number;
  revenueMtd: number;
  profitMtd: number;
  pendingCashouts: { count: number; amount: number };
  unsettledOrders: number;
  lastRuns: { id: string; asOf: string; status: string; ordersSettled: number; ordersCharged: number; cashoutsCreated: number; triggeredBy: string; startedAt: string; error: string | null }[];
}
interface Account { code: string; nameEn: string; nameAr: string; type: string; description: string }

export default function FinanceOverviewPage() {
  const { api, t, lang } = useApp();
  const { data, error, loading, reload } = useAsync(() => api.get<Overview>('/finance/overview'), []);
  const accounts = useAsync(() => api.get<Account[]>('/finance/accounts'), []);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<unknown>(null);

  async function runCycle() {
    setRunning(true);
    setRunError(null);
    try {
      await api.post('/finance/settlement/run', {});
      reload();
    } catch (e) {
      setRunError(e);
    } finally {
      setRunning(false);
    }
  }

  if (loading && !data) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t.finance} subtitle={new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'full' })} />

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">{t.cashPosition}</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label={t.cashWithDrivers} value={data.cashWithDrivers} hint={t.cashWithDriversHint} />
          <Tile label={t.fawryReceivable} value={data.fawryReceivable} hint={t.fawryReceivableHint} />
          <Tile label={t.bank} value={data.bank} />
          <Tile label={t.owedToMerchants} value={data.merchantWallets + data.codAwaitingSettlement} hint={t.owedToMerchantsHint} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted">{t.thisMonth}</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label={t.revenueExVat} value={data.revenueMtd} tone="text-emerald-700" />
          <Tile label={t.profit} value={data.profitMtd} tone={data.profitMtd < 0 ? 'text-rose-700' : 'text-emerald-700'} />
          <Tile label={t.vatPayable} value={data.vatPayable} />
          <Link href="/finance/cashouts" className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card hover:border-accent">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">{t.pendingCashouts}</div>
            <div className="mt-2 font-display text-xl font-semibold"><Money value={data.pendingCashouts.amount} /></div>
            <div className="mt-1 text-xs text-accent-strong">{data.pendingCashouts.count} {t.waitingApproval}</div>
          </Link>
        </div>
      </section>

      <Card
        title={t.cashCycle}
        actions={<Button onClick={runCycle} disabled={running}>{running ? t.loading : t.runCashCycle}</Button>}
      >
        <p className="mb-4 text-sm text-muted">
          {t.cycleExplain} <span className="font-medium text-text">{data.unsettledOrders}</span> {t.ordersWaitingRun}
        </p>
        <ErrorBox error={runError} />
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pe-3 text-start font-medium">{t.when}</th>
                <th className="px-3 py-2 text-start font-medium">{t.status}</th>
                <th className="px-3 py-2 text-end font-medium">{t.deliveredSettled}</th>
                <th className="px-3 py-2 text-end font-medium">{t.failedCharged}</th>
                <th className="px-3 py-2 text-end font-medium">{t.autoCashouts}</th>
                <th className="py-2 ps-3 text-start font-medium">{t.triggeredBy}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.lastRuns.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-muted">{t.none}</td></tr>
              )}
              {data.lastRuns.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2 pe-3 text-xs text-muted">{formatDateTime(r.startedAt, lang)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${r.status === 'DONE' ? 'bg-emerald-50 text-emerald-800' : r.status === 'RUNNING' ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-800'}`} title={r.error ?? ''}>
                      {r.status}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-end">{r.ordersSettled}</td>
                  <td className="tabular px-3 py-2 text-end">{r.ordersCharged}</td>
                  <td className="tabular px-3 py-2 text-end">{r.cashoutsCreated}</td>
                  <td className="py-2 ps-3 text-xs text-muted">{r.triggeredBy.startsWith('manual') ? t.manual : r.triggeredBy === 'schedule' ? t.schedule : r.triggeredBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t.chartOfAccounts} flush>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-line">
              {(accounts.data ?? []).map((a) => (
                <tr key={a.code}>
                  <td className="px-5 py-2 font-mono text-xs text-muted">{a.code}</td>
                  <td className="px-3 py-2 font-medium">{lang === 'ar' ? a.nameAr : a.nameEn}</td>
                  <td className="px-3 py-2 text-xs text-muted">{a.type}</td>
                  <td className="px-5 py-2 text-xs text-muted">{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-2 font-display text-xl font-semibold ${tone ?? 'text-text'}`}><Money value={value} /></div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
