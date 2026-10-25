'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import type { SettingRow, SettingsList } from '@/lib/dashboard-types';
import { formatCairoDateTime } from '@/lib/format';

const KNOWN = ['invalid_setting_value', 'validation_failed'];
const input = 'h-10 w-24 rounded-md border border-line bg-surface px-2 text-body-sm';
const button =
  'h-10 rounded-md bg-selected-bg px-3 text-body-sm font-bold text-link disabled:opacity-50';

export function SettingsEditor({ initial }: { initial: SettingsList }) {
  const [data, setData] = useState(initial);
  return (
    <ul className="mt-6 space-y-4">
      {data.settings.map((s) => (
        <SettingCard key={s.key} setting={s} stores={data.stores} onSaved={setData} />
      ))}
    </ul>
  );
}

function SettingCard({
  setting,
  stores,
  onSaved,
}: {
  setting: SettingRow;
  stores: SettingsList['stores'];
  onSaved(next: SettingsList): void;
}) {
  const t = useTranslations('admin.settings');
  const locale = useLocale();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newStore, setNewStore] = useState('');

  async function save(scope: string, raw: string | null) {
    const value = raw === null ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || raw!.trim() === ''))
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
    setNewStore('');
    onSaved(result.data);
  }

  const free = stores.filter((s) => !setting.overrides.some((o) => o.darkStoreId === s.id));
  // Message keys cannot contain dots, so sla.pick_minutes is stored as sla__pick_minutes.
  const nameKey = `names.${setting.key.replace(/\./g, '__')}`;
  const name = t.has(nameKey) ? t(nameKey) : setting.key;

  return (
    <li className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-body font-bold">{name}</h2>
          <p className="text-caption text-text-muted">
            <span className="ltr-iso">{setting.key}</span> ·{' '}
            {t('default', { value: setting.default })}
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
        value={setting.global ?? setting.default}
        hint={
          setting.globalUpdatedBy && setting.globalUpdatedAt
            ? t('changedBy', {
                name: setting.globalUpdatedBy,
                time: formatCairoDateTime(setting.globalUpdatedAt, locale),
              })
            : null
        }
        busy={busy}
        onSave={(v) => void save('global', v)}
      />

      {setting.overrides.map((o) => {
        const store = stores.find((s) => s.id === o.darkStoreId);
        return (
          <ValueRow
            key={o.darkStoreId}
            label={store ? localized(store, locale) : o.darkStoreId}
            value={o.value ?? setting.default}
            hint={
              o.updatedBy
                ? t('changedBy', {
                    name: o.updatedBy,
                    time: formatCairoDateTime(o.updatedAt, locale),
                  })
                : null
            }
            busy={busy}
            onSave={(v) => void save(o.darkStoreId, v)}
            onRemove={() => void save(o.darkStoreId, null)}
          />
        );
      })}

      {free.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <label className="text-caption text-text-muted" htmlFor={`add-${setting.key}`}>
            {t('addOverride')}
          </label>
          <select
            id={`add-${setting.key}`}
            value={newStore}
            onChange={(e) => setNewStore(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          >
            <option value="">{t('chooseStore')}</option>
            {free.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
          {newStore && (
            <ValueEditor
              key={newStore}
              fresh
              value={setting.global ?? setting.default}
              busy={busy}
              onSave={(v) => void save(newStore, v)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ValueRow(props: {
  label: string;
  value: number;
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
        busy={props.busy}
        onSave={props.onSave}
        onRemove={props.onRemove}
      />
      {props.hint && <span className="text-caption text-text-muted">{props.hint}</span>}
    </div>
  );
}

function ValueEditor(props: {
  value: number;
  busy: boolean;
  /** A new store value may start equal to the global one and still be saved */
  fresh?: boolean;
  onSave(value: string): void;
  onRemove?(): void;
}) {
  const t = useTranslations('admin.settings');
  const [value, setValue] = useState(String(props.value));
  return (
    <span className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="numeric"
        dir="ltr"
        className={input}
        aria-label={t('save')}
      />
      <button
        type="button"
        className={button}
        disabled={props.busy || (!props.fresh && value === String(props.value))}
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
