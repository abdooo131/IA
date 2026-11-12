'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import type { AppId } from '@/lib/apps';
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
type Unit = 'egp' | 'percent' | 'number' | 'coordinate';
/** Map coordinates (the office location) are decimal degrees, typed as they are. */
const unitOf = (key: string): Unit =>
  key.endsWith('_piastres')
    ? 'egp'
    : key.endsWith('_bp')
      ? 'percent'
      : /_(lat|lng)$/.test(key)
        ? 'coordinate'
        : 'number';
const show = (value: number, unit: Unit) =>
  unit === 'number' || unit === 'coordinate'
    ? String(value)
    : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
function read(text: string, unit: Unit): number | null {
  const v = text.trim();
  if (unit === 'coordinate') return /^-?\d{1,3}(\.\d{1,7})?$/.test(v) ? Number(v) : null;
  if (unit !== 'number') return parseEgp(text);
  return /^\d+$/.test(v) ? Number(v) : null;
}

/** Which tab each setting lives on, by the start of its key. */
type Tab =
  | 'delivery'
  | 'stock'
  | 'merchants'
  | 'customers'
  | 'fees'
  | 'payroll'
  | 'money'
  | 'tickets'
  | 'hr'
  | 'sales'
  | 'other';
/** Each app's Configuration shows only its own settings. */
const APP_TABS: Record<AppId, Tab[]> = {
  operations: ['delivery'],
  inventory: ['stock'],
  merchants: ['merchants'],
  customers: ['customers'],
  accounting: ['fees', 'payroll', 'money'],
  hr: ['hr'],
  sales: ['sales'],
  system: ['tickets', 'other'],
};
function tabOf(key: string): Tab {
  if (key === 'finance.corporate_tax_bp' || key.startsWith('payroll.')) return 'payroll';
  if (/^(sla|delivery|store|tracking)\./.test(key)) return 'delivery';
  if (/^(fee|rider)\./.test(key)) return 'fees';
  if (key.startsWith('signup.')) return 'merchants';
  if (['finance.', 'claims.', 'storage.', 'receivables.', 'cash.'].some((p) => key.startsWith(p)))
    return 'money';
  if (/^(stock|refill)\./.test(key)) return 'stock';
  if (key.startsWith('customer.')) return 'customers';
  if (key.startsWith('ticket.')) return 'tickets';
  if (key.startsWith('hr.')) return 'hr';
  if (key.startsWith('sales.')) return 'sales';
  return 'other';
}

export function SettingsEditor({ initial, app }: { initial: SettingsList; app: AppId }) {
  const t = useTranslations('admin.settings');
  const [data, setData] = useState(initial);
  const tabs = APP_TABS[app].filter((k) => data.settings.some((s) => tabOf(s.key) === k));
  const [tab, setTab] = useState<Tab>(tabs[0] ?? APP_TABS[app][0]!);
  return (
    <>
      {tabs.length > 1 && (
        <nav className="-mx-1 mt-4 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-current={tab === k ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-body-sm font-semibold ${
                tab === k
                  ? 'border-primary text-link'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </nav>
      )}
      {tab === 'fees' && (
        <p className="mt-4 rounded-lg border border-line bg-surface p-3 text-body-sm text-text-muted">
          {t('merchantPricesInContract')}
        </p>
      )}
      <ul className="mt-6 space-y-4">
        {data.settings
          .filter((s) => tabOf(s.key) === tab)
          .map((s) => (
            <SettingCard key={s.key} setting={s} list={data} onSaved={setData} />
          ))}
      </ul>
    </>
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
  // A merchant's own prices live in their contract (merchant contracts v2), never here.
  const targets =
    setting.override === 'store'
      ? list.stores.map((s) => ({ scope: s.id, label: localized(s, locale) }))
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
            {t('addOverride')}
          </label>
          <select
            id={`add-${setting.key}`}
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          >
            <option value="">{t('chooseStore')}</option>
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
  /** A new store value may start equal to the global one and still be saved */
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
      {(props.unit === 'egp' || props.unit === 'percent') && (
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
