'use client';

import { Button, Card, ErrorBox, inputClass, Spinner, useApp, useAsync } from '@shiply/ui';
import { useMemo, useState } from 'react';

interface ConfigRow {
  key: string;
  value: unknown;
  defaultValue: unknown;
  valueType: 'int' | 'bool' | 'string' | 'json';
  category: string;
  description: string;
  updatedAt: string;
}

export default function ConfigPage() {
  const { api, t } = useApp();
  const { data, error, loading, reload } = useAsync(() => api.get<ConfigRow[]>('/admin/config'), []);
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, ConfigRow[]>();
    for (const r of data ?? []) {
      if (filter && !`${r.key} ${r.description}`.toLowerCase().includes(filter.toLowerCase())) continue;
      m.set(r.category, [...(m.get(r.category) ?? []), r]);
    }
    return [...m.entries()];
  }, [data, filter]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t.systemConfig}</h1>
        <input className={`${inputClass} max-w-xs`} placeholder="Filter keys" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="text-sm text-slate-600">
        Money values are integer piastres (100 = 1 EGP). Rates are basis points (10000 = 100%). Every change is written to the audit log.
      </p>
      {groups.map(([cat, rows]) => (
        <Card key={cat} title={cat}>
          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <ConfigEditor key={r.key} row={r} onSaved={reload} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ConfigEditor({ row, onSaved }: { row: ConfigRow; onSaved: () => void }) {
  const { api, t } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stringify(row.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const modified = JSON.stringify(row.value) !== JSON.stringify(row.defaultValue);

  async function save() {
    setError(null);
    let value: unknown;
    try {
      value =
        row.valueType === 'int' ? Number(draft) : row.valueType === 'bool' ? draft === 'true' : row.valueType === 'json' ? JSON.parse(draft) : draft;
      await api.patch(`/admin/config/${encodeURIComponent(row.key)}`, { value, reason: reason || undefined });
      setEditing(false);
      setReason('');
      onSaved();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2 py-3 md:grid-cols-12 md:items-center" data-config-key={row.key}>
      <div className="md:col-span-5">
        <div className="font-mono text-xs text-slate-900">
          {row.key} {modified && <span className="ms-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">modified</span>}
        </div>
        <div className="text-xs text-slate-500">{row.description}</div>
      </div>
      <div className="md:col-span-5">
        {editing ? (
          <div className="space-y-2">
            {row.valueType === 'bool' ? (
              <select className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : row.valueType === 'json' ? (
              <textarea className={`${inputClass} font-mono`} rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <input className={`${inputClass} font-mono`} value={draft} onChange={(e) => setDraft(e.target.value)} inputMode={row.valueType === 'int' ? 'numeric' : 'text'} />
            )}
            <input className={inputClass} placeholder={t.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
            <ErrorBox error={error} />
          </div>
        ) : (
          <div className="font-mono text-sm">
            {stringify(row.value)} <span className="text-xs text-slate-400">({t.defaultValue}: {stringify(row.defaultValue)})</span>
          </div>
        )}
      </div>
      <div className="flex gap-2 md:col-span-2 md:justify-end">
        {editing ? (
          <>
            <Button onClick={save}>{t.save}</Button>
            <Button variant="secondary" onClick={() => { setEditing(false); setDraft(stringify(row.value)); }}>{t.cancel}</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)}>{t.edit}</Button>
        )}
      </div>
    </div>
  );
}

function stringify(v: unknown) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}
