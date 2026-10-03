'use client';

import { FAILED_ATTEMPT_REASONS, FailedAttemptReason, OrderStatus } from '@shiply/shared';
import { Button, ErrorBox, inputBase, inputClass, Money, PageHeader, Spinner, StatusBadge, useApp, useAsync } from '@shiply/ui';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BulkResult, BulkResultBox, Column, DriverSelect, HubSelect, SelectableTable, useDrivers, useRunSheet, useSelectedHub } from '../shared';

interface Row {
  id: string;
  trackingNumber: string;
  status: OrderStatus;
  codAmount: number;
  customerName: string;
  customerPhone: string;
  area: string;
  addressLine: string;
  attempts: number;
  lastFailedReason: FailedAttemptReason | null;
  allowOpenPackage: boolean;
  deliveryDriverId: string | null;
  merchant: { nameEn: string; nameAr: string };
  deliveryDriver: { id: string; fullName: string } | null;
}
interface Board { atHub: Row[]; withDrivers: Row[]; awaitingMerchant: Row[] }

type Tab = 'atHub' | 'withDrivers' | 'awaitingMerchant';

export default function DeliveriesPage() {
  const { api, t, lang } = useApp();
  const { hubs, hubId, setHubId } = useSelectedHub((h) => h.dispatchesLastMile);
  const board = useAsync(() => (hubId ? api.get<Board>(`/ops/deliveries?hubId=${hubId}`) : Promise.resolve(null)), [hubId]);
  const drivers = useDrivers('DELIVERY');
  const runSheet = useRunSheet();
  const [tab, setTab] = useState<Tab>('atHub');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState<FailedAttemptReason | ''>('');
  const [driverFilter, setDriverFilter] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(path: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<BulkResult>(path, { ids: [...selected], ...body }));
      setSelected(new Set());
      board.reload();
      drivers.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const r = board.data?.[tab] ?? [];
    return tab === 'withDrivers' && driverFilter ? r.filter((o) => o.deliveryDriverId === driverFilter) : r;
  }, [board.data, tab, driverFilter]);

  const hubDrivers = (drivers.data ?? []).filter((d) => d.status === 'ACTIVE');
  const columns: Column<Row>[] = [
    { key: 'tn', label: t.tracking, render: (o) => <Link href={`/orders/${o.id}`} className="font-mono text-xs text-accent-strong hover:underline">{o.trackingNumber}</Link> },
    { key: 'st', label: t.status, render: (o) => <StatusBadge status={o.status} /> },
    {
      key: 'cust',
      label: t.customer,
      render: (o) => (
        <div>
          <div>{o.customerName}</div>
          <div className="text-xs text-muted" dir="ltr">{o.customerPhone}</div>
        </div>
      ),
    },
    { key: 'addr', label: t.address, render: (o) => <div className="max-w-xs truncate text-xs" title={o.addressLine}>{o.area} · {o.addressLine}</div> },
    { key: 'merch', label: t.merchant, render: (o) => (lang === 'ar' ? o.merchant.nameAr : o.merchant.nameEn) },
    { key: 'cod', label: t.cod, className: 'text-end', render: (o) => <Money value={o.codAmount} /> },
    {
      key: 'drv',
      label: t.driver,
      render: (o) => (
        <div className="text-xs">
          {o.deliveryDriver?.fullName ?? <span className="text-muted">{t.notAssigned}</span>}
          {o.attempts > 0 && <div className="text-orange-700">{t.attempt} {o.attempts}{o.lastFailedReason ? ` · ${t[`r_${o.lastFailedReason}`]}` : ''}</div>}
        </div>
      ),
    },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'atHub', label: t.atHub },
    { key: 'withDrivers', label: t.withDrivers },
    { key: 'awaitingMerchant', label: t.awaitingMerchantTab },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.deliveries} subtitle={t.deliveriesSubtitle} actions={<HubSelect hubs={hubs} value={hubId} onChange={setHubId} />} />

      <div className="flex flex-wrap gap-2">
        {hubDrivers.filter((d) => d.hubId === hubId).map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2 text-sm ring-1 ring-inset ring-line">
            <div>
              <div className="font-medium">{d.fullName}</div>
              <div className="text-xs text-muted">{d.openDeliveries} {t.parcels} · <Money value={d.cashHeld} /> {t.cashHeldShort}</div>
            </div>
            <Button variant="ghost" className="px-2 text-xs" onClick={() => runSheet(d)}>{t.runSheet}</Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => {
              setTab(x.key);
              setSelected(new Set());
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === x.key ? 'bg-ink text-white' : 'text-muted ring-1 ring-inset ring-line hover:bg-surface'}`}
          >
            {x.label} ({board.data?.[x.key].length ?? 0})
          </button>
        ))}
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <span className="text-sm font-medium">{selected.size} {t.selected}</span>
        {tab !== 'withDrivers' && (
          <>
            <DriverSelect drivers={hubDrivers} value={driverId} onChange={setDriverId} hubId={hubId} />
            <Button disabled={!selected.size || !driverId || busy} onClick={() => run('/ops/deliveries/assign', { driverId })}>
              {tab === 'atHub' ? t.assign : t.reattempt}
            </Button>
          </>
        )}
        {tab === 'withDrivers' && (
          <>
            <select className={`${inputBase} w-auto`} value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} aria-label={t.driver}>
              <option value="">{t.allDrivers}</option>
              {hubDrivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
            <Button variant="secondary" disabled={!selected.size || busy} onClick={() => run('/ops/deliveries/out', {})}>{t.outForDelivery}</Button>
            <Button disabled={!selected.size || busy} onClick={() => run('/ops/deliveries/delivered', {})} data-testid="mark-delivered">{t.markDelivered}</Button>
            <select className={`${inputBase} w-auto`} value={reason} onChange={(e) => setReason(e.target.value as FailedAttemptReason)} aria-label={t.failReason}>
              <option value="">{t.failReason}</option>
              {FAILED_ATTEMPT_REASONS.map((r) => <option key={r} value={r}>{t[`r_${r}`]}</option>)}
            </select>
            <Button variant="danger" disabled={!selected.size || !reason || busy} onClick={() => run('/ops/deliveries/failed', { reason })}>{t.markFailed}</Button>
          </>
        )}
        {tab === 'awaitingMerchant' && (
          <Button variant="secondary" disabled={!selected.size || busy} onClick={() => run('/ops/returns/start', {})}>{t.startReturn}</Button>
        )}
      </div>
      <BulkResultBox result={result} onClose={() => setResult(null)} />
      <ErrorBox error={error} />

      <section className="rounded-xl border border-line bg-surface shadow-card">
        {board.loading && !board.data ? <Spinner /> : <SelectableTable rows={rows} columns={columns} selected={selected} onSelected={setSelected} empty={t.none} testId="delivery-table" />}
      </section>
    </div>
  );
}
