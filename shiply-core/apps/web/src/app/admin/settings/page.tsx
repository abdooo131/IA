'use client';
import { useState } from 'react';
import { SETTINGS, egpToPiastres, type SettingKey } from '@shiply/shared';
import { Alert, Button, Card, Input, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short names and explanations for each setting. */
const LABELS: Record<SettingKey, [string, string]> = {
  'promise.cutoff': ['Daily cutoff', 'Parcels entering after this time count from tomorrow'],
  'promise.weekend_days': ['Days with no deliveries', 'Skipped when counting the promised date'],
  'delivery.max_attempts': ['Delivery attempts', 'Failed attempts before the parcel goes back to the merchant'],
  'fees.cod_fee_bp': ['COD fee', 'Charged on cash above the free amount'],
  'fees.cod_free_amount': ['COD free amount', 'Cash we collect with no COD fee'],
  'fees.return_fee_bp': ['Return fee', 'Share of shipping charged when a parcel comes back'],
  'tracking.prefix': ['Tracking number prefix', 'Letters at the start of every tracking number'],
  'cash.shortage_alert': ['Courier cash alert', 'Cash difference that raises an alert'],
};

function toText(kind: string, value: unknown): string {
  if (kind === 'money') return String((value as number) / 100);
  if (kind === 'bp') return String((value as number) / 100);
  return String(value ?? '');
}

function SettingRow({ name, value, onSaved }: { name: SettingKey; value: unknown; onSaved: () => Promise<void> }) {
  const t = useT();
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
      setMsg({ ok: false, text: t('Check the value') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api(`/admin/settings/${name}`, { method: 'PUT', body: { value: v } });
      setMsg({ ok: true, text: t('Saved') });
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
          <label key={d} className="flex items-center gap-1 rounded-md bg-surface-raised px-2 py-1 text-body-sm ring-1 ring-line">
            <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((x) => x !== i))} />
            {t(d)}
          </label>
        ))}
      </div>
    );
  } else {
    const suffix = def.kind === 'money' ? t('EGP') : def.kind === 'bp' ? '%' : null;
    input = (
      <div className="flex items-center gap-2">
        <Input
          type={def.kind === 'time' ? 'time' : 'text'}
          inputMode={def.kind === 'time' || def.kind === 'text' ? undefined : 'decimal'}
          className="w-36"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {suffix && <span className="text-body-sm text-text-muted">{suffix}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-line py-4 last:border-0 md:flex-row md:items-center">
      <div className="md:w-1/2">
        <div className="text-body-sm font-bold">{t(LABELS[name][0])}</div>
        <div className="text-caption text-text-muted">{t(LABELS[name][1])}</div>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {input}
        <Button tone="secondary" disabled={busy} onClick={save}>{t('Save')}</Button>
        {msg && <span className={msg.ok ? 'text-caption font-bold text-status-delivered' : 'text-caption font-bold text-danger'}>{msg.text}</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const { data, error, reload } = useLoad<Record<string, unknown>>('/admin/settings');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('Setup')} title={t('Settings')} subtitle={t('Business rules used by every facility, hub and courier. Changes apply to new actions at once.')} />
      <Card>
        {(Object.keys(SETTINGS) as SettingKey[]).map((key) => (
          <SettingRow key={`${key}-${JSON.stringify(data[key])}`} name={key} value={data[key]} onSaved={reload} />
        ))}
      </Card>
    </div>
  );
}
