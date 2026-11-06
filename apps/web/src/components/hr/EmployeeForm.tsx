'use client';

import { DEPARTMENTS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { type EmployeeFile, employeeName, type StoreRef } from '@/lib/hr-types';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text disabled:bg-surface-raised';

const KNOWN_ERRORS = [
  'validation_failed',
  'salaries_required',
  'manager_loop',
  'manager_is_self',
  'contract_end_required',
  'contract_ends_before_hire',
  'probation_ends_before_hire',
  'phone_taken',
  'store_not_allowed',
  'employment_set_in_payroll',
];

/** The editable fields of a file, as text (empty means not given). */
function valuesOf(file: EmployeeFile) {
  const s = (v: string | null | undefined) => v ?? '';
  return {
    nameEn: file.nameEn,
    nameAr: s(file.nameAr),
    nationalId: s(file.nationalId),
    nationalIdExpiresOn: s(file.nationalIdExpiresOn),
    birthDate: s(file.birthDate),
    address: s(file.address),
    mobile: file.mobile ? `0${file.mobile.slice(3)}` : '',
    emergencyName: s(file.emergencyName),
    emergencyPhone: file.emergencyPhone ? `0${file.emergencyPhone.slice(3)}` : '',
    jobTitle: s(file.jobTitle),
    department: s(file.department),
    managerId: file.manager?.id ?? '',
    homeStoreId: file.homeStore?.id ?? '',
    hireDate: s(file.hireDate),
    contractType: file.contractType,
    contractEndsOn: s(file.contractEndsOn),
    probationEndsOn: s(file.probationEndsOn),
    socialInsuranceNumber: s(file.socialInsuranceNumber),
    bankName: s(file.bank?.bankName),
    bankAccountNumber: s(file.bank?.bankAccountNumber),
    iban: s(file.bank?.iban),
    bankAccountHolder: s(file.bank?.bankAccountHolder),
  };
}

type Values = ReturnType<typeof valuesOf>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 rounded-lg border border-line p-4">
      <legend className="px-1 text-h3">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** The employee's details. HR use may change them; bank details need the salaries switch. */
export function EmployeeForm({
  file,
  stores,
  managers,
  canEdit,
}: {
  file: EmployeeFile;
  stores: StoreRef[];
  managers: { id: string; code: string; nameEn: string; nameAr: string | null }[];
  canEdit: boolean;
}) {
  const t = useTranslations('hr');
  const locale = useLocale();
  const router = useRouter();
  const initial = useMemo(() => valuesOf(file), [file]);
  const [values, setValues] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showBank = file.bank !== null;
  const outsourced = file.employment === 'outsourced';
  const changed = (Object.keys(values) as (keyof Values)[]).filter((k) => values[k] !== initial[k]);
  const dirty = changed.length > 0;

  const set = (key: keyof Values) => (e: { target: { value: string } }) => {
    setNotice(null);
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };

  async function save() {
    setBusy(true);
    setError(null);
    const body: Record<string, string | null> = {};
    for (const k of changed) body[k] = values[k].trim() === '' ? null : values[k].trim();
    if (body.nameEn === null) delete body.nameEn;
    if (body.contractType === null) delete body.contractType;
    const result = await apiSend<EmployeeFile>('PATCH', `/hr/employees/${file.id}`, body);
    setBusy(false);
    if (!result.ok)
      return setError(
        t(`errors.${KNOWN_ERRORS.includes(result.error) ? result.error : 'generic'}`),
      );
    setNotice(t('saved'));
    router.refresh();
  }

  const text = (
    key: keyof Values,
    label: string,
    extra: { dir?: string; inputMode?: 'numeric' | 'tel' } = {},
  ) => (
    <label className="block text-caption">
      {label}
      <input
        value={values[key]}
        onChange={set(key)}
        dir={extra.dir}
        inputMode={extra.inputMode}
        className={field}
      />
    </label>
  );
  const date = (key: keyof Values, label: string) => (
    <label className="block text-caption">
      {label}
      <span className="mt-1 block">
        <DateInput
          value={values[key]}
          onChange={set(key)}
          className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
        />
      </span>
    </label>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="mt-4 max-w-3xl space-y-4"
    >
      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-4">
        <Section title={t('sections.identity')}>
          {text('nameEn', t('fields.nameEn'))}
          {text('nameAr', t('fields.nameAr'), { dir: 'rtl' })}
          {text('nationalId', t('fields.nationalId'), { dir: 'ltr', inputMode: 'numeric' })}
          {date('nationalIdExpiresOn', t('fields.nationalIdExpiresOn'))}
          {date('birthDate', t('fields.birthDate'))}
          {text('socialInsuranceNumber', t('fields.socialInsuranceNumber'), { dir: 'ltr' })}
        </Section>

        <Section title={t('sections.contact')}>
          {text('mobile', t('fields.mobile'), { dir: 'ltr', inputMode: 'tel' })}
          <label className="block text-caption sm:col-span-2">
            {t('fields.address')}
            <textarea
              value={values.address}
              onChange={set('address')}
              rows={2}
              className={`${field} h-auto py-2`}
            />
          </label>
          {text('emergencyName', t('fields.emergencyName'))}
          {text('emergencyPhone', t('fields.emergencyPhone'), { dir: 'ltr', inputMode: 'tel' })}
        </Section>

        <Section title={t('sections.job')}>
          {text('jobTitle', t('fields.jobTitle'))}
          <label className="block text-caption">
            {t('fields.department')}
            <select value={values.department} onChange={set('department')} className={field}>
              <option value="">–</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {t(`departments.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-caption">
            {t('fields.manager')}
            <select value={values.managerId} onChange={set('managerId')} className={field}>
              <option value="">–</option>
              {managers
                .filter((m) => m.id !== file.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {employeeName(m, locale)} ({m.code})
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-caption">
            {t('fields.homeStore')}
            <select
              value={values.homeStoreId}
              onChange={set('homeStoreId')}
              disabled={file.storeFromAccount}
              className={field}
            >
              <option value="">{t('office')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s, locale)}
                </option>
              ))}
            </select>
            {file.storeFromAccount && (
              <span className="mt-1 block text-text-muted">{t('storeFromAccount')}</span>
            )}
          </label>
        </Section>

        <Section title={t('sections.contract')}>
          {date('hireDate', t('fields.hireDate'))}
          <label className="block text-caption">
            {t('fields.contractType')}
            <select
              value={values.contractType}
              onChange={set('contractType')}
              disabled={outsourced}
              className={field}
            >
              {(outsourced
                ? (['outsourced'] as const)
                : (['permanent', 'fixed_term', 'part_time'] as const)
              ).map((c) => (
                <option key={c} value={c}>
                  {t(`contractTypes.${c}`)}
                </option>
              ))}
            </select>
            {outsourced && (
              <span className="mt-1 block text-text-muted">
                {t('outsourcedBy', { supplier: file.staffingSupplier?.name ?? '–' })}
              </span>
            )}
          </label>
          {date('contractEndsOn', t('fields.contractEndsOn'))}
          {date('probationEndsOn', t('fields.probationEndsOn'))}
        </Section>

        {showBank && (
          <Section title={t('sections.bank')}>
            {text('bankName', t('fields.bankName'))}
            {text('bankAccountNumber', t('fields.bankAccountNumber'), { dir: 'ltr' })}
            {text('iban', t('fields.iban'), { dir: 'ltr' })}
            {text('bankAccountHolder', t('fields.bankAccountHolder'))}
          </Section>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-sm">
          {notice}
        </p>
      )}
      {canEdit && (
        <FormFooter
          dirty={dirty}
          busy={busy}
          disabled={!dirty}
          saveLabel={t('save')}
          onCancel={() => {
            setValues(initial);
            setError(null);
          }}
        />
      )}
    </form>
  );
}
