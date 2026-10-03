'use client';

import { OrderStatus } from '@shiply/shared';
import { Button, Card, ErrorBox, formatDateTime, inputClass, PageHeader, Spinner, StatusBadge, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { FormEvent, use, useRef, useState } from 'react';

interface Transfer {
  id: string;
  code: string;
  status: 'OPEN' | 'IN_TRANSIT' | 'RECEIVED';
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  vehicle: string | null;
  originHub: { code: string; nameEn: string; nameAr: string };
  destinationHub: { code: string; nameEn: string; nameAr: string };
  driver: { fullName: string; phone: string } | null;
  items: { id: string; scannedOutAt: string; scannedInAt: string | null; order: { id: string; trackingNumber: string; status: OrderStatus; area: string; merchant: { nameEn: string; nameAr: string } } }[];
}
interface ScanResult { ok: boolean; code: string; trackingNumber?: string; message: string; warning?: string }

const STYLE = { OPEN: 'bg-slate-100 text-slate-700', IN_TRANSIT: 'bg-sky-50 text-sky-800', RECEIVED: 'bg-emerald-50 text-emerald-800' };

export default function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { api, t, lang } = useApp();
  const tr = useAsync(() => api.get<Transfer>(`/ops/transfers/${id}`), [id]);
  const [code, setCode] = useState('');
  const [last, setLast] = useState<ScanResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function scan(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c || !tr.data) return;
    setCode('');
    const path = tr.data.status === 'OPEN' ? 'scan-out' : 'scan-in';
    try {
      setLast(await api.post<ScanResult>(`/ops/transfers/${id}/${path}`, { code: c }));
      tr.reload();
    } catch (err) {
      setError(err);
    }
    input.current?.focus();
  }

  async function act(path: 'dispatch' | 'close') {
    setError(null);
    try {
      const r = await api.post<{ missing?: string[] }>(`/ops/transfers/${id}/${path}`);
      setLast(null);
      if (path === 'close') setMissing(r.missing ?? []);
      tr.reload();
    } catch (err) {
      setError(err);
    }
  }

  if (tr.loading && !tr.data) return <Spinner />;
  if (tr.error || !tr.data) return <ErrorBox error={tr.error} />;
  const d = tr.data;
  const received = d.items.filter((i) => i.scannedInAt).length;
  const hubName = (h: { nameEn: string; nameAr: string }) => (lang === 'ar' ? h.nameAr : h.nameEn);

  return (
    <div className="space-y-6">
      <Link href="/operations/transfers" className="text-sm text-accent-strong hover:underline">{lang === 'ar' ? '→' : '←'} {t.transfers}</Link>
      <PageHeader
        title={<span className="font-mono">{d.code}</span>}
        subtitle={<>{hubName(d.originHub)} → {hubName(d.destinationHub)}{d.driver && ` · ${d.driver.fullName}`}{d.vehicle && ` · ${d.vehicle}`}</>}
        actions={
          <>
            <span className={`rounded-md px-2 py-1 text-xs font-medium ${STYLE[d.status]}`}>{t[`tr${d.status}`]}</span>
            {d.status === 'OPEN' && <Button onClick={() => act('dispatch')} disabled={d.items.length === 0}>{t.dispatchTransfer}</Button>}
            {d.status === 'IN_TRANSIT' && <Button variant="dark" onClick={() => act('close')}>{t.closeTransfer}</Button>}
          </>
        }
      />
      {d.status !== 'RECEIVED' && (
        <form onSubmit={scan} className="rounded-xl border-2 border-dashed border-accent/60 bg-surface p-5">
          <label htmlFor="scan" className="mb-2 block text-sm font-medium">{d.status === 'OPEN' ? t.scanOutHelp : t.scanInHelp}</label>
          <input id="scan" ref={input} autoFocus autoComplete="off" dir="ltr" className={`${inputClass} py-3 font-mono text-lg tracking-wider`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="SHP0000000000" data-testid="scan-input" />
        </form>
      )}
      {last && (
        <p className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${last.ok ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'}`} data-testid="scan-last">
          <span className="font-mono">{last.trackingNumber ?? last.code}</span>: {last.message}
          {last.warning && <span className="ms-2 text-amber-800">⚠ {last.warning}</span>}
        </p>
      )}
      <ErrorBox error={error} />
      {missing && missing.length > 0 && <ErrorBox error={`${t.missingParcels}: ${missing.join(', ')}`} />}
      <Card title={`${t.itemsOnManifest} · ${received}/${d.items.length} ${t.receivedWord}`} flush>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="manifest">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-5 py-2 text-start font-medium">{t.tracking}</th>
                <th className="px-3 py-2 text-start font-medium">{t.merchant}</th>
                <th className="px-3 py-2 text-start font-medium">{t.status}</th>
                <th className="px-3 py-2 text-start font-medium">{t.scanOut}</th>
                <th className="px-5 py-2 text-start font-medium">{t.scanIn}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.items.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-muted">{t.none}</td></tr>}
              {d.items.map((i) => (
                <tr key={i.id} className={d.status !== 'OPEN' && !i.scannedInAt ? 'bg-amber-50/60' : ''}>
                  <td className="px-5 py-2"><Link className="font-mono text-xs text-accent-strong hover:underline" href={`/orders/${i.order.id}`}>{i.order.trackingNumber}</Link></td>
                  <td className="px-3 py-2">{lang === 'ar' ? i.order.merchant.nameAr : i.order.merchant.nameEn}</td>
                  <td className="px-3 py-2"><StatusBadge status={i.order.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{formatDateTime(i.scannedOutAt, lang)}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-xs">{i.scannedInAt ? formatDateTime(i.scannedInAt, lang) : <span className="text-amber-800">{d.status === 'OPEN' ? '' : t.notYet}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
