'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import type { SettingRow, SettingsList } from '@/lib/dashboard-types';
import { formatCairoDateTime } from '@/lib/format';
import { parseEgp } from '@/lib/money';

const KNOWN = ['invalid_setting_value', 'validation_failed', 'scope_not_allowed'];
const input = 'h-10 w-28 rounded-md border border-line bg-surface px-2 text-body-sm';
const button =
  'h-10 rounded-md bg-selected-bg px-3 text-body-sm font-bold text-link disabled:opacity-50';

/**
 * Money settings are stored in piastres and shares in basis points, but people type
 * pounds and percents: 45 means 45.00 EGP, 2.5 means 2.5%.
 */
type Unit = 'egp' | 'percent' | 'number';
const unitOf = (key: string): Unit =>
  key.endsWith('_piastres') ? 'egp' : key.endsWith('_bp') ? 'percent' : 'number';
const show = (value: number, unit: Unit) =>
  unit === 'number'
    ? String(value)
    : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
function read(text: string, unit: Unit): number | null {
  if (unit !== 'number') return parseEgp(text);
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

export function SettingsEditor({ initial }: { initial: SettingsList }) {
  const [data, setData] = useState(initial);
  return (
    <ul className="mt-6 space-y-4">
      {data.settings.map((s) => (
        <SettingCard key={s.key} setting={s} list={data} onSaved={setData} />
      ))}
    </ul>
  );
}

function SettingCard({
  setting,
  list,
  onSaved,
}: {
  setting: SettingRow;
  list: SettingsList;
  onSaved(next: SettingsList): void;
}) {
  const t = useTranslations('admin.settings');
  const locale = useLocale();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newScope, setNewScope] = useState('');
  const unit = unitOf(setting.key);

  // Where this setting may differ from the global value.
  const targets =
    setting.override === 'store'
      ? list.stores.map((s) => ({ scope: s.id, label: localized(s, locale) }))
      : setting.override === 'merchant'
        ? list.merchants.map((m) => ({ scope: `merchant:${m.id}`, label: m.name }))
        : [];
  const labelOf = (scope: string) => targets.find((x) => x.scope === scope)?.label ?? scope;

  async function save(scope: string, raw: string | null) {
    const value = raw === null ? null : read(raw, unit);
    if (raw !== null && value === null)
      return setMessage({ text: t('errors.validation_failed'), error: true });
    setBusy(true);
    const result = await apiSend<SettingsList>('PUT', '/admin/settings', {
      key: setting.key,
      scope,
      value,
    });
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
    setMessage({ text: t('saved'), error: false });
    setNewScope('');
    onSaved(result.data);
  }

  const free = targets.filter((x) => !setting.overrides.some((o) => o.scope === x.scope));
  // Message keys cannot contain dots, so sla.pick_minutes is stored as sla__pick_minutes.
  const nameKey = `names.${setting.key.replace(/\./g, '__')}`;
  const name = t.has(nameKey) ? t(nameKey) : setting.key;
  const changed = (by: string | null, at: string | null) =>
    by && at ? t('changedBy', { name: by, time: formatCairoDateTime(at, locale) }) : null;

  return (
    <li className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-body font-bold">{name}</h2>
          <p className="text-caption text-text-muted">
            <span className="ltr-iso">{setting.key}</span> ·{' '}
            {t('default', { value: show(setting.default, unit) })}
          </p>
        </div>
        {message && (
          <p
            role="status"
            className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
          >
            {message.text}
          </p>
        )}
      </div>

      <ValueRow
        label={t('global')}
        value={show(setting.global ?? setting.default, unit)}
        unit={unit}
        hint={changed(setting.globalUpdatedBy, setting.globalUpdatedAt)}
        busy={busy}
        onSave={(v) => void save('global', v)}
      />

      {setting.overrides.map((o) => (
        <ValueRow
          key={o.scope}
          label={labelOf(o.scope)}
          value={show(o.value ?? setting.default, unit)}
          unit={unit}
          hint={changed(o.updatedBy, o.updatedAt)}
          busy={busy}
          onSave={(v) => void save(o.scope, v)}
          onRemove={() => void save(o.scope, null)}
        />
      ))}

      {free.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <label className="text-caption text-text-muted" htmlFor={`add-${setting.key}`}>
            {setting.override === 'merchant' ? t('addMerchantOverride') : t('addOverride')}
          </label>
          <select
            id={`add-${setting.key}`}
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          >
            <option value="">
              {setting.override === 'merchant' ? t('chooseMerchant') : t('chooseStore')}
            </option>
            {free.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.label}
              </option>
            ))}
          </select>
          {newScope && (
            <ValueEditor
              key={newScope}
              fresh
              value={show(setting.global ?? setting.default, unit)}
              unit={unit}
              busy={busy}
              onSave={(v) => void save(newScope, v)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ValueRow(props: {
  label: string;
  value: string;
  unit: Unit;
  hint: string | null;
  busy: boolean;
  onSave(value: string): void;
  onRemove?(): void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="w-40 text-body-sm font-bold">{props.label}</span>
      <ValueEditor
        value={props.value}
        unit={props.unit}
        busy={props.busy}
        onSave={props.onSave}
        onRemove={props.onRemove}
      />
      {props.hint && <span className="text-caption text-text-muted">{props.hint}</span>}
    </div>
  );
}

function ValueEditor(props: {
  value: string;
  unit: Unit;
  busy: boolean;
  /** A new store or merchant value may start equal to the global one and still be saved */
  fresh?: boolean;
  onSave(value: string): void;
  onRemove?(): void;
}) {
  const t = useTranslations('admin.settings');
  const [value, setValue] = useState(props.value);
  return (
    <span className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode={props.unit === 'number' ? 'numeric' : 'decimal'}
        dir="ltr"
        className={input}
        aria-label={t('save')}
      />
      {props.unit !== 'number' && (
        <span className="text-caption text-text-muted">
          {props.unit === 'egp' ? t('unitEgp') : '%'}
        </span>
      )}
      <button
        type="button"
        className={button}
        disabled={props.busy || (!props.fresh && value === props.value)}
        onClick={() => props.onSave(value)}
      >
        {t('save')}
      </button>
      {props.onRemove && (
        <button
          type="button"
          className="h-10 rounded-md border border-line px-3 text-body-sm text-danger disabled:opacity-50"
          disabled={props.busy}
          onClick={props.onRemove}
        >
          {t('remove')}
        </button>
      )}
    </span>
  );
}
