'use client';

import { Button, ErrorBox, formatDateTime, inputBase, inputClass, PageHeader, Spinner, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useState } from 'react';

interface Alert {
  id: string;
  kind: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
}

const SEV = { HIGH: 'bg-rose-500', MEDIUM: 'bg-amber-500', LOW: 'bg-slate-400' };

export default function AlertsPage() {
  const { api, t, lang } = useApp();
  const [status, setStatus] = useState('OPEN');
  const list = useAsync(() => api.get<Alert[]>(`/ops/alerts?status=${status}`), [status]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function resolve(id: string) {
    setError(null);
    try {
      await api.post(`/ops/alerts/${id}/resolve`, { resolution: text });
      setResolving(null);
      setText('');
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t.alerts} subtitle={t.alertsSubtitle} />
      <div className="flex gap-2">
        {['OPEN', 'RESOLVED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-ink text-white' : 'text-muted ring-1 ring-inset ring-line hover:bg-surface'}`}>
            {s === 'OPEN' ? t.openAlerts : t.resolvedAlerts}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        <ul className="space-y-3" data-testid="alerts">
          {(list.data ?? []).length === 0 && <li className="text-sm text-muted">{t.none}</li>}
          {(list.data ?? []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface px-5 py-3 shadow-card">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEV[a.severity]}`} title={a.severity} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium uppercase tracking-wider text-muted">{t[`a_${a.kind}` as 'a_MISROUTE'] ?? a.kind}</div>
                <div className="text-sm">{a.message}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {formatDateTime(a.createdAt, lang)}
                  {a.entityType === 'order' && a.entityId && <> · <Link className="text-accent-strong hover:underline" href={`/orders/${a.entityId}`}>{t.details}</Link></>}
                  {a.entityType === 'transfer' && a.entityId && <> · <Link className="text-accent-strong hover:underline" href={`/operations/transfers/${a.entityId}`}>{t.details}</Link></>}
                  {a.resolution && ` · ${a.resolution}`}
                </div>
              </div>
              {a.status === 'OPEN' &&
                (resolving === a.id ? (
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <input className={`${inputBase} w-64`} placeholder={t.resolution} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
                    <Button disabled={text.trim().length < 3} onClick={() => resolve(a.id)}>{t.resolve}</Button>
                    <Button variant="secondary" onClick={() => setResolving(null)}>{t.cancel}</Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setResolving(a.id)}>{t.resolve}</Button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
