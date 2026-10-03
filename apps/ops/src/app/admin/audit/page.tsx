'use client';

import { Button, ErrorBox, formatDateTime, inputClass, Spinner, useApp } from '@shiply/ui';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface AuditRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const { api, t, lang } = useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filters, setFilters] = useState({ entityType: '', action: '', entityId: '' });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams({ take: '50' });
        for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
        if (cursor) p.set('cursor', cursor);
        const page = await api.get<AuditRow[]>(`/admin/audit?${p}`);
        setRows((prev) => (cursor ? [...prev, ...page] : page));
        setDone(page.length < 50);
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [api, filters],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t.auditLog}</h1>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input className={`${inputClass} max-w-[12rem]`} placeholder={t.entity} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} />
        <input className={`${inputClass} max-w-[14rem]`} placeholder="Entity id" value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })} />
        <input className={`${inputClass} max-w-[12rem]`} placeholder={t.action} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
        <Button type="submit">{t.filter}</Button>
      </form>
      <ErrorBox error={error} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-start">{t.when}</th>
              <th className="px-3 py-2 text-start">{t.who}</th>
              <th className="px-3 py-2 text-start">{t.action}</th>
              <th className="px-3 py-2 text-start">{t.entity}</th>
              <th className="px-3 py-2 text-start">{t.before}</th>
              <th className="px-3 py-2 text-start">{t.after}</th>
              <th className="px-3 py-2 text-start">{t.reason}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{formatDateTime(r.createdAt, lang)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.actorRole}
                  <div className="font-mono text-[10px] text-slate-400">{r.actorId?.slice(0, 8)}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 text-xs">
                  {r.entityType}
                  <div className="font-mono text-[10px] text-slate-400">{r.entityId}</div>
                </td>
                <td className="max-w-xs px-3 py-2"><Json v={r.before} /></td>
                <td className="max-w-xs px-3 py-2"><Json v={r.after} /></td>
                <td className="px-3 py-2 text-xs">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <Spinner />}
      {!loading && !done && rows.length > 0 && (
        <Button variant="secondary" onClick={() => load(rows[rows.length - 1].id)}>{t.next}</Button>
      )}
    </div>
  );
}

function Json({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-slate-300">-</span>;
  return <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-700">{JSON.stringify(v, null, 1)}</pre>;
}
