'use client';

import { OrderStatus } from '@shiply/shared';
import { Button, ErrorBox, formatDateTime, PageHeader, Spinner, StatusBadge, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useState } from 'react';
import { BulkResult, BulkResultBox, Column, DriverSelect, SelectableTable, useDrivers } from '../shared';

interface Row {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  lastFailedReason: string | null;
  customerName: string;
  updatedAt: string;
  merchant: { nameEn: string; nameAr: string };
  pickupLocation: { name: string; area: string } | null;
  pickupDriver: { fullName: string } | null;
}

export default function ReturnsPage() {
  const { api, t, lang } = useApp();
  const list = useAsync(() => api.get<Row[]>('/ops/returns'), []);
  const drivers = useDrivers('PICKUP');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(path: string, body: object = {}) {
    setError(null);
    try {
      setResult(await api.post<BulkResult>(path, { ids: [...selected], ...body }));
      setSelected(new Set());
      list.reload();
    } catch (e) {
      setError(e);
    }
  }

  const columns: Column<Row>[] = [
    { key: 'tn', label: t.tracking, render: (o) => <Link href={`/orders/${o.id}`} className="font-mono text-xs text-accent-strong hover:underline">{o.trackingNumber}</Link> },
    { key: 'st', label: t.status, render: (o) => <StatusBadge status={o.status} /> },
    { key: 'm', label: t.merchant, render: (o) => <div>{lang === 'ar' ? o.merchant.nameAr : o.merchant.nameEn}<div className="text-xs text-muted">{o.pickupLocation?.name}</div></div> },
    { key: 'r', label: t.failReason, render: (o) => <span className="text-xs">{o.lastFailedReason ? t[`r_${o.lastFailedReason}` as 'r_CUSTOMER_REFUSED'] : '-'}</span> },
    { key: 'd', label: t.driver, render: (o) => <span className="text-xs">{o.pickupDriver?.fullName ?? '-'}</span> },
    { key: 'u', label: t.when, render: (o) => <span className="text-xs text-muted">{formatDateTime(o.updatedAt, lang)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.returns} subtitle={t.returnsSubtitle} />
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-sm font-medium">{selected.size} {t.selected}</span>
        <DriverSelect drivers={drivers.data ?? []} value={driverId} onChange={setDriverId} />
        <Button disabled={!selected.size || !driverId} onClick={() => run('/ops/returns/to-merchant', { driverId })}>{t.sendToMerchant}</Button>
        <Button variant="dark" disabled={!selected.size} onClick={() => run('/ops/returns/returned')}>{t.markReturned}</Button>
      </div>
      <BulkResultBox result={result} onClose={() => setResult(null)} />
      <ErrorBox error={error} />
      <section className="rounded-xl border border-line bg-surface shadow-card">
        {list.loading && !list.data ? <Spinner /> : <SelectableTable rows={list.data ?? []} columns={columns} selected={selected} onSelected={setSelected} empty={t.none} />}
      </section>
    </div>
  );
}
