'use client';

import {
  ACCESS_APPS,
  ACCESS_LEVELS,
  type AccessApp,
  type AccessLevel,
  type AccessProfile,
  type AccessTemplate,
  APP_LEVELS,
  JOB_ROLE_TEMPLATES,
  JOB_ROLES,
  type JobRole,
  matchJobRole,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { FormFooter } from '@/components/workflow/FormFooter';

export type AccessStoreRef = { id: string; code: string; nameEn: string; nameAr: string };

type Values = AccessTemplate & { storeIds: string[] };

const ACCESS_ERRORS = [
  'last_owner',
  'no_access',
  'store_not_allowed',
  'cannot_change_own_access',
  'stores_required',
  'dark_store_not_found',
  'not_team_member',
  'user_not_found',
  'validation_failed',
];

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

function toValues(profile: AccessProfile): Values {
  const { jobRole: _label, storeIds, merchantIds: _merchants, ...rest } = profile;
  return { ...rest, storeIds: [...storeIds].sort() };
}

const same = (a: Values, b: Values) =>
  JSON.stringify({ ...a, storeIds: [...a.storeIds].sort() }) ===
  JSON.stringify({ ...b, storeIds: [...b.storeIds].sort() });

/** The translated message for a refusal of the access endpoints. */
export function useAccessError() {
  const t = useTranslations('admin.users.access.errors');
  return (code: string) => t(ACCESS_ERRORS.includes(code) ? code : 'generic');
}

/** The job role picker: every job role, plus custom when the values match none. */
export function JobRoleSelect({
  value,
  onChange,
  allowCustom,
  name,
}: {
  value: JobRole | 'custom';
  onChange(role: JobRole): void;
  allowCustom: boolean;
  name?: string;
}) {
  const t = useTranslations('admin.users');
  return (
    <label className="block text-caption">
      {t('access.jobRole')}
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value as JobRole)}
        className={field}
      >
        {allowCustom && (
          <option value="custom" disabled>
            {t('jobRoles.custom')}
          </option>
        )}
        {JOB_ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`jobRoles.${r}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Ticks for the stores a person works in (used when they do not cover every store). */
export function StorePicker({
  stores,
  selected,
  onChange,
  disabled = false,
}: {
  stores: AccessStoreRef[];
  selected: string[];
  onChange(ids: string[]): void;
  disabled?: boolean;
}) {
  const locale = useLocale();
  return (
    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
      {stores.map((s) => {
        const on = selected.includes(s.id);
        return (
          <li key={s.id}>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-body-sm">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() =>
                  onChange(on ? selected.filter((id) => id !== s.id) : [...selected, s.id])
                }
                className="h-4 w-4"
              />
              <span className="min-w-0 truncate">
                {localized(s, locale)} <span className="ltr-iso text-text-muted">{s.code}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One team member's access (docs/ACCESS.md): a job role fills every field, then each app's
 * level, the stores they cover and the customer data and salaries switches can be changed
 * (the job role then reads custom). Nobody changes their own access: their row is read only.
 */
export function AccessEditor({
  userId,
  isMe,
  stores,
  onSaved,
}: {
  userId: string;
  isMe: boolean;
  stores: AccessStoreRef[];
  onSaved(): void;
}) {
  const t = useTranslations('admin.users');
  const errorText = useAccessError();
  const [loaded, setLoaded] = useState<Values | null>(null);
  /** The job role last picked or stored: tells apart roles with the same values. */
  const [label, setLabel] = useState<JobRole | 'custom'>('custom');
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void apiGetClient<{ profile: AccessProfile }>(`/admin/users/${userId}/access`).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(errorText(r.error));
      const v = toValues(r.data.profile);
      setLabel(r.data.profile.jobRole);
      setLoaded(v);
      setValues(v);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  const jobRole = useMemo(() => (values ? matchJobRole(values, label) : 'custom'), [values, label]);
  const dirty = !!values && !!loaded && !same(values, loaded);

  if (!values) {
    return (
      <section className="mt-4 rounded-lg border border-line p-4">
        <h3 className="text-h3">{t('access.title')}</h3>
        {error ? (
          <p role="alert" className="mt-2 text-body-sm text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-body-sm text-text-muted">{t('access.loading')}</p>
        )}
      </section>
    );
  }

  const set = (patch: Partial<Values>) => {
    setNotice(null);
    setValues({ ...values, ...patch });
  };

  async function save() {
    if (!values) return;
    setBusy(true);
    setError(null);
    const storeIds = values.allStores ? [] : values.storeIds;
    const { storeIds: _ids, ...levels } = values;
    const body = jobRole === 'custom' ? { jobRole, ...levels, storeIds } : { jobRole, storeIds };
    const result = await apiSend<{ profile: AccessProfile }>(
      'PUT',
      `/admin/users/${userId}/access`,
      body,
    );
    setBusy(false);
    if (!result.ok) return setError(errorText(result.error));
    const v = toValues(result.data.profile);
    setLabel(result.data.profile.jobRole);
    setLoaded(v);
    setValues(v);
    setNotice(t('access.saved'));
    onSaved();
  }

  const levelName = (level: AccessLevel) => t(`access.levels.${level}`);
  const appName = (app: AccessApp) => t(`access.apps.${app}`);

  return (
    <section
      className="mt-4 rounded-lg border border-line p-4"
      aria-labelledby={`access-${userId}`}
    >
      <h3 id={`access-${userId}`} className="text-h3">
        {t('access.title')}
      </h3>
      {isMe ? (
        <p className="mt-1 rounded-md bg-surface-raised px-3 py-2 text-body-sm">
          {t('access.own')}
        </p>
      ) : (
        <p className="mt-1 text-body-sm text-text-muted">{t('access.intro')}</p>
      )}
      <fieldset disabled={isMe || busy} className="mt-3 min-w-0 space-y-4">
        <div className="max-w-sm">
          <JobRoleSelect
            value={jobRole}
            allowCustom
            onChange={(role) => {
              setLabel(role);
              set({ ...JOB_ROLE_TEMPLATES[role], storeIds: values.storeIds });
            }}
          />
        </div>

        <div className="max-w-2xl overflow-x-auto rounded-md border border-line">
          <table className="w-full text-body-sm">
            <caption className="sr-only">{t('access.tableCaption')}</caption>
            <thead className="bg-surface-raised text-caption text-text-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-semibold">
                  {t('access.app')}
                </th>
                {ACCESS_LEVELS.map((level) => (
                  <th key={level} scope="col" className="px-1 py-2 text-center font-semibold">
                    {levelName(level)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ACCESS_APPS.map((app) => (
                <tr key={app}>
                  <th scope="row" className="px-2 py-1.5 text-start font-semibold">
                    {appName(app)}
                  </th>
                  {ACCESS_LEVELS.map((level) => (
                    <td key={level} className="px-1 py-1.5 text-center">
                      {APP_LEVELS[app].includes(level) ? (
                        <label className="inline-flex h-10 w-10 cursor-pointer items-center justify-center">
                          <input
                            type="radio"
                            name={`${userId}-${app}`}
                            checked={values[app] === level}
                            onChange={() => set({ [app]: level } as Partial<Values>)}
                            aria-label={`${appName(app)}: ${levelName(level)}`}
                            className="h-4 w-4"
                          />
                        </label>
                      ) : (
                        <span aria-hidden="true" className="text-text-muted">
                          –
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-2xl text-caption text-text-muted">{t('access.levelsHint')}</p>

        <div>
          <label className="flex min-h-10 items-center gap-2 text-body-sm font-semibold">
            <input
              type="checkbox"
              checked={values.allStores}
              onChange={(e) => set({ allStores: e.target.checked })}
              className="h-4 w-4"
            />
            {t('access.allStores')}
          </label>
          {!values.allStores && (
            <>
              <p className="text-caption text-text-muted">{t('access.storesHint')}</p>
              <StorePicker
                stores={stores}
                selected={values.storeIds}
                onChange={(storeIds) => set({ storeIds })}
                disabled={isMe || busy}
              />
            </>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={values.customerData}
              onChange={(e) => set({ customerData: e.target.checked })}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">{t('access.customerData')}</span>
              <span className="block text-caption text-text-muted">
                {t('access.customerDataHint')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={values.ownMerchantsOnly}
              onChange={(e) => set({ ownMerchantsOnly: e.target.checked })}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">{t('access.ownMerchantsOnly')}</span>
              <span className="block text-caption text-text-muted">
                {t('access.ownMerchantsOnlyHint')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={values.ownDealsOnly}
              onChange={(e) => set({ ownDealsOnly: e.target.checked })}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">{t('access.ownDealsOnly')}</span>
              <span className="block text-caption text-text-muted">
                {t('access.ownDealsOnlyHint')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={values.salaries}
              onChange={(e) => set({ salaries: e.target.checked })}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">{t('access.salaries')}</span>
              <span className="block text-caption text-text-muted">{t('access.salariesHint')}</span>
            </span>
          </label>
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-body-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-body-sm">
          {notice}
        </p>
      )}
      {!isMe && (
        <div className="mt-4">
          <FormFooter
            dirty={dirty}
            busy={busy}
            saveLabel={t('access.save')}
            disabled={!dirty}
            onSave={() => void save()}
            onCancel={() => {
              setValues(loaded);
              setError(null);
            }}
          />
        </div>
      )}
    </section>
  );
}
