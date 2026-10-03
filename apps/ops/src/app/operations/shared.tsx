'use client';

import { inputBase, inputClass, useApp, useAsync, usePdfViewer } from '@shiply/ui';
import { ReactNode, useEffect, useState } from 'react';

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  type: 'PICKUP' | 'DELIVERY';
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  vehicle: string;
  hubId: string | null;
  hub: { code: string; nameEn: string; nameAr: string } | null;
  openPickups: number;
  openDeliveries: number;
  cashHeld: number;
  shortageOwed: number;
}
export interface Hub { id: string; code: string; nameEn: string; nameAr: string; receivesPickups: boolean; dispatchesLastMile: boolean }
export interface BulkResult { ok: { id: string; trackingNumber: string; status: string }[]; failed: { id: string; trackingNumber?: string; error: string }[] }

export function useDrivers(type?: 'PICKUP' | 'DELIVERY') {
  const { api } = useApp();
  return useAsync(() => api.get<Driver[]>(`/ops/drivers${type ? `?type=${type}` : ''}`), [type]);
}

export function useHubs() {
  const { api } = useApp();
  return useAsync(() => api.get<Hub[]>('/admin/hubs'), []);
}

/** Remembers the hub a staff member works at, per browser. */
export function useSelectedHub(filter?: (h: Hub) => boolean) {
  const hubs = useHubs();
  const [hubId, setHubId] = useState('');
  useEffect(() => {
    if (!hubs.data) return;
    let stored = '';
    try {
      stored = localStorage.getItem('shiply.ops.hub') ?? '';
    } catch {
      /* ignore */
    }
    const list = hubs.data.filter(filter ?? (() => true));
    setHubId(list.find((h) => h.id === stored)?.id ?? list[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubs.data]);
  const choose = (id: string) => {
    setHubId(id);
    try {
      localStorage.setItem('shiply.ops.hub', id);
    } catch {
      /* ignore */
    }
  };
  return { hubs: (hubs.data ?? []).filter(filter ?? (() => true)), hubId, setHubId: choose };
}

export function HubSelect({ hubs, value, onChange, label }: { hubs: Hub[]; value: string; onChange: (id: string) => void; label?: string }) {
  const { lang, t } = useApp();
  return (
    <select className={`${inputBase} w-auto min-w-[14rem]`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? t.hub} data-testid="hub-select">
      {hubs.map((h) => (
        <option key={h.id} value={h.id}>
          {h.code} · {lang === 'ar' ? h.nameAr : h.nameEn}
        </option>
      ))}
    </select>
  );
}

export function DriverSelect({ drivers, value, onChange, hubId }: { drivers: Driver[]; value: string; onChange: (id: string) => void; hubId?: string }) {
  const { t } = useApp();
  const active = drivers.filter((d) => d.status === 'ACTIVE');
  const sorted = hubId ? [...active].sort((a, b) => Number(b.hubId === hubId) - Number(a.hubId === hubId)) : active;
  return (
    <select className={`${inputBase} w-auto min-w-[14rem]`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={t.selectDriver} data-testid="driver-select">
      <option value="">{t.selectDriver}</option>
      {sorted.map((d) => (
        <option key={d.id} value={d.id}>
          {d.fullName}
          {d.hub ? ` · ${d.hub.code}` : ''}
        </option>
      ))}
    </select>
  );
}

/** Shows how a bulk action went: how many worked and why any failed. */
export function BulkResultBox({ result, onClose }: { result: BulkResult | null; onClose: () => void }) {
  const { t } = useApp();
  if (!result) return null;
  return (
    <div className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${result.failed.length ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-emerald-50 text-emerald-900 ring-emerald-200'}`} role="status" data-testid="bulk-result">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="font-medium">
            {result.ok.length} {t.doneCount}
          </span>
          {result.failed.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {result.failed.map((f) => (
                <li key={f.id}>
                  <span className="font-mono">{f.trackingNumber ?? f.id.slice(0, 8)}</span>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-xs underline">
          {t.close}
        </button>
      </div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

/** Table with row checkboxes; the parent owns the selected ids. */
export function SelectableTable<T extends { id: string }>({
  rows,
  columns,
  selected,
  onSelected,
  empty,
  testId,
}: {
  rows: T[];
  columns: Column<T>[];
  selected: Set<string>;
  onSelected: (s: Set<string>) => void;
  empty: string;
  testId?: string;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm" data-testid={testId}>
        <thead className="bg-paper text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="w-10 px-3 py-2">
              <input type="checkbox" aria-label="select all" checked={all} onChange={() => onSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
            </th>
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 text-start font-medium ${c.className ?? ''}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted">{empty}</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className={selected.has(r.id) ? 'bg-accent-soft/50' : 'hover:bg-paper'}>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`select ${r.id}`}
                  checked={selected.has(r.id)}
                  onChange={() => {
                    const n = new Set(selected);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    onSelected(n);
                  }}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function useRunSheet() {
  const { t } = useApp();
  const { open } = usePdfViewer();
  return (d: { id: string; fullName: string }) =>
    open({ title: `${t.runSheet} · ${d.fullName}`, fileName: `runsheet-${d.fullName.replace(/\s+/g, '-')}.pdf`, path: `/ops/drivers/${d.id}/runsheet` });
}
