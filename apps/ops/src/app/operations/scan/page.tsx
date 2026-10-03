'use client';

import { Card, ErrorBox, PageHeader, STATUS_LABELS, StatusBadge, inputClass, useApp, useAsync } from '@shiply/ui';
import { OrderStatus } from '@shiply/shared';
import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';
import { HubSelect, useSelectedHub } from '../shared';

interface ScanResult { ok: boolean; code: string; trackingNumber?: string; from?: string; to?: string; message: string; warning?: string }
interface Inventory {
  total: number;
  byStatus: Record<string, number>;
  orders: { id: string; trackingNumber: string; status: OrderStatus; isReturning: boolean; area: string; destinationHub: { code: string } | null; merchant: { nameEn: string; nameAr: string } }[];
}

/**
 * Receiving parcels at a hub. A USB or Bluetooth barcode scanner types the tracking number and presses Enter,
 * so the input stays focused and each scan is processed immediately.
 */
export default function ScanPage() {
  const { api, t, lang } = useApp();
  const { hubs, hubId, setHubId } = useSelectedHub();
  const [code, setCode] = useState('');
  const [log, setLog] = useState<ScanResult[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const inventory = useAsync(() => (hubId ? api.get<Inventory>(`/ops/hubs/${hubId}/inventory`) : Promise.resolve(null)), [hubId]);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c || !hubId) return;
    setCode('');
    setError(null);
    try {
      const r = await api.post<ScanResult>(`/ops/hubs/${hubId}/receive`, { code: c });
      setLog((l) => [r, ...l].slice(0, 100));
      if (r.ok) inventory.reload();
    } catch (err) {
      setError(err);
    }
    input.current?.focus();
  }

  const okCount = log.filter((l) => l.ok).length;
  const label = (s?: string) => (s ? STATUS_LABELS[lang][s as OrderStatus] ?? s : '');

  return (
    <div className="space-y-6">
      <PageHeader title={t.hubScan} subtitle={t.scanSubtitle} actions={<HubSelect hubs={hubs} value={hubId} onChange={setHubId} />} />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <form onSubmit={submit} className="rounded-xl border-2 border-dashed border-accent/60 bg-surface p-5">
            <label htmlFor="scan" className="mb-2 block text-sm font-medium">{t.scanHere}</label>
            <input
              id="scan"
              ref={input}
              autoFocus
              autoComplete="off"
              className={`${inputClass} py-3 font-mono text-lg tracking-wider`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SHP0000000000"
              dir="ltr"
              data-testid="scan-input"
            />
            <div className="mt-3 flex gap-4 text-sm text-muted">
              <span>{t.scanned}: <b className="text-text">{log.length}</b></span>
              <span className="text-emerald-700">{t.received}: <b>{okCount}</b></span>
              <span className="text-rose-700">{t.problems}: <b>{log.length - okCount}</b></span>
            </div>
          </form>
          <ErrorBox error={error} />
          <Card title={t.scanLog} flush>
            {log.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted">{t.none}</p>
            ) : (
              <ul className="divide-y divide-line" data-testid="scan-log">
                {log.map((r, i) => (
                  <li key={i} className={`flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm ${r.ok ? '' : 'bg-rose-50'}`}>
                    <span className={`h-2.5 w-2.5 rounded-full ${r.ok ? (r.warning ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-rose-500'}`} />
                    <span className="font-mono">{r.trackingNumber ?? r.code}</span>
                    {r.ok && r.from && r.to && r.from !== r.to ? (
                      <span className="text-muted">{label(r.from)} → <b className="text-text">{label(r.to)}</b></span>
                    ) : (
                      <span className={r.ok ? 'text-muted' : 'text-rose-800'}>{r.message}</span>
                    )}
                    {r.warning && <span className="text-xs text-amber-800">⚠ {r.warning}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={`${t.inventory} (${inventory.data?.total ?? 0})`} flush>
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {Object.entries(inventory.data?.byStatus ?? {}).map(([s, n]) => (
              <span key={s} className="rounded-md bg-paper px-2 py-0.5 text-xs">{label(s)}: <b>{n}</b></span>
            ))}
          </div>
          <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
            {(inventory.data?.orders ?? []).map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-5 py-2 text-xs">
                <Link href={`/orders/${o.id}`} className="font-mono text-accent-strong hover:underline">{o.trackingNumber}</Link>
                <StatusBadge status={o.status} />
                {o.isReturning && <span className="rounded bg-rose-50 px-1 text-rose-700">{t.returning}</span>}
                <span className="ms-auto truncate text-muted">{o.area} {o.destinationHub && `→ ${o.destinationHub.code}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
