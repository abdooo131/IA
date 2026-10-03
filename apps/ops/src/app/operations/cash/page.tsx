'use client';

import { egpToPiastres } from '@shiply/shared';
import { Button, Card, ErrorBox, formatDateTime, inputBase, inputClass, Money, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import { useState } from 'react';

interface DriverCash {
  id: string;
  fullName: string;
  phone: string;
  hub: string | null;
  cashHeld: number;
  shortageOwed: number;
  pendingOrders: { id: string; trackingNumber: string; codAmount: number; finalizedAt: string; customerName: string }[];
}
interface Handover {
  id: string;
  expectedAmount: number;
  receivedAmount: number;
  difference: number;
  status: 'BALANCED' | 'SHORT' | 'OVER';
  note: string | null;
  createdAt: string;
  driver: { fullName: string };
  _count: { orders: number };
}

const STATUS_STYLE = { BALANCED: 'bg-emerald-50 text-emerald-800', SHORT: 'bg-rose-50 text-rose-800', OVER: 'bg-amber-50 text-amber-800' };

export default function DriverCashPage() {
  const { api, t, lang } = useApp();
  const summary = useAsync(() => api.get<{ drivers: DriverCash[]; hubSafes: number }>('/ops/cash'), []);
  const history = useAsync(() => api.get<Handover[]>('/ops/cash/history'), []);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [repay, setRepay] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handover(d: DriverCash) {
    setError(null);
    setDone(null);
    const received = egpToPiastres(amounts[d.id] ?? (d.cashHeld / 100).toFixed(2));
    if (received === null) return setError(new Error('Enter the amount like 1250 or 1250.50'));
    try {
      const h = await api.post<Handover>('/ops/cash/handover', { driverId: d.id, receivedAmount: received });
      setDone(`${d.fullName}: ${t[`h${h.status}`]}`);
      setAmounts({ ...amounts, [d.id]: '' });
      summary.reload();
      history.reload();
    } catch (err) {
      setError(err);
    }
  }

  async function repayShortage(d: DriverCash) {
    setError(null);
    const amount = egpToPiastres(repay[d.id] ?? '');
    if (!amount) return setError(new Error('Enter the amount repaid'));
    try {
      await api.post('/ops/cash/shortage-repaid', { driverId: d.id, amount });
      setRepay({ ...repay, [d.id]: '' });
      summary.reload();
    } catch (err) {
      setError(err);
    }
  }

  if (summary.loading && !summary.data) return <Spinner />;
  if (summary.error || !summary.data) return <ErrorBox error={summary.error} />;
  const total = summary.data.drivers.reduce((s, d) => s + d.cashHeld, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.driverCash}
        subtitle={t.driverCashSubtitle}
        actions={
          <div className="flex gap-4 text-sm">
            <span>{t.cashWithDrivers}: <Money value={total} className="font-semibold" /></span>
            <span>{t.hubSafes}: <Money value={summary.data.hubSafes} className="font-semibold" /></span>
          </div>
        }
      />
      <ErrorBox error={error} />
      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{done}</p>}
      <div className="grid gap-4 lg:grid-cols-2" data-testid="driver-cash">
        {summary.data.drivers.map((d) => (
          <section key={d.id} className="rounded-xl border border-line bg-surface shadow-card">
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
              <div>
                <div className="font-medium">{d.fullName}</div>
                <div className="text-xs text-muted" dir="ltr">{d.phone}{d.hub && ` · ${d.hub}`}</div>
              </div>
              <div className="text-end">
                <div className="text-xs text-muted">{t.expectedCash}</div>
                <div className="font-display text-lg font-semibold"><Money value={d.cashHeld} /></div>
              </div>
            </header>
            <div className="space-y-3 px-5 py-3">
              {d.pendingOrders.length > 0 && (
                <ul className="max-h-36 space-y-1 overflow-y-auto text-xs">
                  {d.pendingOrders.map((o) => (
                    <li key={o.id} className="flex justify-between gap-2">
                      <span className="font-mono">{o.trackingNumber}</span>
                      <span className="truncate text-muted">{o.customerName}</span>
                      <Money value={o.codAmount} />
                    </li>
                  ))}
                </ul>
              )}
              {d.cashHeld > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputBase} w-40`}
                    dir="ltr"
                    inputMode="decimal"
                    aria-label={`${t.receivedCash} ${d.fullName}`}
                    value={amounts[d.id] ?? (d.cashHeld / 100).toFixed(2)}
                    onChange={(e) => setAmounts({ ...amounts, [d.id]: e.target.value })}
                  />
                  <Button onClick={() => handover(d)}>{t.recordHandover}</Button>
                </div>
              )}
              {d.shortageOwed > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
                  <span>{t.shortageOwed}: <Money value={d.shortageOwed} className="font-semibold" /></span>
                  <input className={`${inputBase} w-28`} dir="ltr" inputMode="decimal" value={repay[d.id] ?? ''} onChange={(e) => setRepay({ ...repay, [d.id]: e.target.value })} aria-label={`${t.repayShortage} ${d.fullName}`} />
                  <Button variant="secondary" onClick={() => repayShortage(d)}>{t.repayShortage}</Button>
                </div>
              )}
              {d.cashHeld === 0 && d.shortageOwed === 0 && <p className="text-sm text-muted">{t.nothingToHandIn}</p>}
            </div>
          </section>
        ))}
      </div>

      <Card title={t.handoverHistory} flush>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 text-start font-medium">{t.when}</th>
                <th className="px-3 py-2 text-start font-medium">{t.driver}</th>
                <th className="px-3 py-2 text-end font-medium">{t.expectedCash}</th>
                <th className="px-3 py-2 text-end font-medium">{t.receivedCash}</th>
                <th className="px-3 py-2 text-end font-medium">{t.difference}</th>
                <th className="px-5 py-2 text-start font-medium">{t.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(history.data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap px-5 py-2 text-xs text-muted">{formatDateTime(h.createdAt, lang)}</td>
                  <td className="px-3 py-2">{h.driver.fullName} <span className="text-xs text-muted">({h._count.orders} {t.parcels})</span></td>
                  <td className="px-3 py-2 text-end"><Money value={h.expectedAmount} /></td>
                  <td className="px-3 py-2 text-end"><Money value={h.receivedAmount} /></td>
                  <td className={`px-3 py-2 text-end ${h.difference < 0 ? 'text-rose-700' : h.difference > 0 ? 'text-amber-700' : ''}`}><Money value={h.difference} /></td>
                  <td className="px-5 py-2"><span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[h.status]}`}>{t[`h${h.status}`]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
