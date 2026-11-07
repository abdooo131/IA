'use client';
import { useState } from 'react';
import { SETTINGS, egpToPiastres, type SettingKey } from '@shiply/shared';
import { Alert, Button, Card, Input, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toText(kind: string, value: unknown): string {
  if (kind === 'money') return String((value as number) / 100);
  if (kind === 'bp') return String((value as number) / 100);
  return String(value ?? '');
}

function SettingRow({ name, value, onSaved }: { name: SettingKey; value: unknown; onSaved: () => Promise<void> }) {
  const def = SETTINGS[name];
  const [text, setText] = useState(toText(def.kind, value));
  const [days, setDays] = useState<number[]>(Array.isArray(value) ? (value as number[]) : []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const parsed = (): unknown => {
    switch (def.kind) {
      case 'money':
        return egpToPiastres(text);
      case 'bp': {
        const pct = Number(text);
        return Number.isFinite(pct) && text.trim() !== '' ? Math.round(pct * 100) : null;
      }
      case 'int': {
        const n = Number(text);
        return Number.isInteger(n) ? n : null;
      }
      case 'weekdays':
        return [...days].sort();
      case 'text':
        return text.trim().toUpperCase();
      default:
        return text;
    }
  };

  const save = async () => {
    const v = parsed();
    if (v === null) {
      setMsg({ ok: false, text: 'Check the value' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/settings/${name}`, { method: 'PUT', body: { value: v } });
      setMsg({ ok: true, text: 'Saved' });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  let input: React.ReactNode;
  if (def.kind === 'weekdays') {
    input = (
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-sm ring-1 ring-slate-200">
            <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))} />
            {d}
          </label>
        ))}
      </div>
    );
  } else {
    const suffix = def.kind === 'money' ? 'EGP' : def.kind === 'bp' ? '%' : null;
    input = (
      <div className="flex items-center gap-2">
        <Input
          type={def.kind === 'time' ? 'time' : 'text'}
          inputMode={def.kind === 'time' || def.kind === 'text' ? undefined : 'decimal'}
          className="w-36"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 py-4 last:border-0 md:flex-row md:items-center">
      <div className="md:w-1/2">
        <div className="text-sm font-medium text-slate-900">{def.label.replace(/ \((piastres|5000 = 50%|100 = 1%)\)$/, '').replace(/ in basis points \(100 = 1%\)$/, '')}</div>
        <div className="font-mono text-xs text-slate-400">{name}</div>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {input}
        <Button tone="secondary" disabled={busy} onClick={save}>Save</Button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-rose-700'}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { data, error, reload } = useLoad<Record<string, unknown>>('/admin/settings');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Business rules used by every hub and courier. Changes apply to new actions at once." />
      <Card>
        {(Object.keys(SETTINGS) as SettingKey[]).map((key) => (
          <SettingRow key={`${key}-${JSON.stringify(data[key])}`} name={key} value={data[key]} onSaved={reload} />
        ))}
      </Card>
    </div>
  );
}
