'use client';

import { ALLOWANCE_KINDS, type AllowanceKind } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import type { EmployeeFile, SalaryPackage } from '@/lib/hr-types';
import { parseEgp } from '@/lib/money';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text disabled:bg-surface-raised';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const egp = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));
const errorKey = (t: ReturnType<typeof useTranslations>, code: string) =>
  t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');

/**
 * How a rider is paid (HR use with the salaries switch): per delivered order through the rider
 * wallet (no salary, no tax or insurance), or a monthly salary on the salary run.
 */
export function PayBasisPanel({ file, canEdit }: { file: EmployeeFile; canEdit: boolean }) {
  const t = useTranslations('riderPay');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = file.payBasis === 'per_delivery' ? 'monthly_salary' : 'per_delivery';
  async function change() {
    setBusy(true);
    setError(null);
    const result = await apiSend('PUT', `/hr/employees/${file.id}/pay-basis`, {
      payBasis: other,
    });
    setBusy(false);
    if (!result.ok)
      return setError(
        t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
      );
    router.refresh();
  }
  return (
    <section
      className="mt-4 max-w-3xl rounded-lg border border-line bg-surface p-4"
      aria-labelledby="pay-basis"
    >
      <h2 id="pay-basis" className="text-h3">
        {t('payBasisTitle')}
      </h2>
      <p className="mt-1 text-body-sm">{t(`payBases.${file.payBasis}`)}</p>
      <p className="mt-1 text-caption text-text-muted">{t(`payBasisHints.${file.payBasis}`)}</p>
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          className="mt-3 h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50"
          onClick={() => void change()}
        >
          {t(`switchTo.${other}`)}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * On our payroll, or hired through an outsourcing company (HR use). A rider paid per delivery
 * is linked to a rider office instead (or works for us directly), and offices take only them.
 */
export function EmploymentPanel({
  file,
  suppliers,
  canEdit,
}: {
  file: EmployeeFile;
  suppliers: { id: string; name: string; isRiderOffice?: boolean }[];
  canEdit: boolean;
}) {
  const t = useTranslations('people');
  const router = useRouter();
  const perDeliveryRider = file.user.role === 'rider' && file.payBasis === 'per_delivery';
  const choices = suppliers.filter((s) => !!s.isRiderOffice === perDeliveryRider);
  const current = file.employment === 'outsourced' ? (file.staffingSupplier?.id ?? '') : '';
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const result = await apiSend(
      'PUT',
      `/hr/employees/${file.id}/employment`,
      value ? { employment: 'outsourced', staffingSupplierId: value } : { employment: 'employee' },
    );
    setBusy(false);
    if (!result.ok) return setError(errorKey(t, result.error));
    router.refresh();
  }
  return (
    <section className="rounded-lg border border-line bg-surface p-4" aria-labelledby="employment">
      <h2 id="employment" className="text-h3">
        {perDeliveryRider ? t('riderOfficeTitle') : t('employmentTitle')}
      </h2>
      <p className="mt-1 text-caption text-text-muted">
        {perDeliveryRider ? t('riderOfficeHint') : t('employmentHint')}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-[240px] flex-1 text-caption">
          {t('employment')}
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canEdit || busy}
            className={field}
          >
            <option value="">
              {perDeliveryRider ? t('noRiderOffice') : t('employments.employee')}
            </option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {perDeliveryRider
                  ? t('riderOfficeVia', { company: s.name })
                  : t('outsourcedVia', { company: s.name })}
              </option>
            ))}
          </select>
        </label>
        {canEdit && value !== current && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
          >
            {t('save')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

interface Line {
  kind: AllowanceKind;
  label: string;
  amount: string;
}

/**
 * The salary package: the one in force, a form for a new one (basic, allowances, insured wage,
 * from a day) and the history. HR use with the salaries switch edits; Accounting only reads.
 */
export function SalaryPackagePanel({
  file,
  history,
  canEdit,
  payrollHref,
}: {
  file: EmployeeFile;
  history: SalaryPackage[];
  canEdit: boolean;
  payrollHref: string | null;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const router = useRouter();
  const current = history.find((h) => h.current) ?? null;
  const start = () => ({
    basic: egp(current?.basicPiastres ?? null),
    insured: egp(current?.insuredWagePiastres ?? null),
    from: '',
    note: '',
    lines: (current?.allowances ?? []).map((a) => ({
      kind: a.kind,
      label: a.label ?? '',
      amount: egp(a.amountPiastres),
    })) as Line[],
  });
  const [form, setForm] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const basic = parseEgp(form.basic);
  const insured = form.insured.trim() ? parseEgp(form.insured) : null;
  const amounts = form.lines.map((l) => parseEgp(l.amount || '0'));
  const valid =
    basic !== null &&
    (form.insured.trim() === '' || insured !== null) &&
    amounts.every((a) => a !== null);
  const gross = (basic ?? 0) + amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const initial = start();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const band = file.grade;
  const outside =
    band &&
    ((band.bandMinPiastres != null && gross < band.bandMinPiastres) ||
      (band.bandMaxPiastres != null && gross > band.bandMaxPiastres));

  if (file.employment === 'outsourced')
    return (
      <p className="mt-4 max-w-3xl rounded-md bg-surface-raised px-3 py-2 text-body-sm">
        {t('paidBy', { company: file.staffingSupplier?.name ?? '–' })}
      </p>
    );

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await apiSend<{ outsideBand: boolean }>(
      'POST',
      `/hr/employees/${file.id}/package`,
      {
        basicPiastres: basic,
        insuredWagePiastres: insured,
        effectiveFrom: form.from || undefined,
        note: form.note.trim() || undefined,
        allowances: form.lines.map((l, i) => ({
          kind: l.kind,
          label: l.label.trim() || undefined,
          amountPiastres: amounts[i] ?? 0,
        })),
      },
    );
    setBusy(false);
    if (!result.ok) return setError(errorKey(t, result.error));
    setNotice(t('packageSaved'));
    router.refresh();
  }

  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  return (
    <div className="mt-4 grid max-w-5xl gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-lg border border-line bg-surface p-4" aria-labelledby="pkg-now">
        <h2 id="pkg-now" className="text-h3">
          {t('packageNow')}
        </h2>
        {current ? (
          <dl className="mt-3 space-y-2 text-body-sm">
            <div className="flex justify-between gap-3">
              <dt>{t('basic')}</dt>
              <dd className="ltr-iso font-bold">{formatEgp(current.basicPiastres)}</dd>
            </div>
            {current.allowances.map((a, i) => (
              <div key={i} className="flex justify-between gap-3">
                <dt>
                  {t(`allowanceKinds.${a.kind}`)}
                  {a.label && <span className="text-text-muted"> · {a.label}</span>}
                </dt>
                <dd className="ltr-iso">{formatEgp(a.amountPiastres)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-2 text-body">
              <dt className="font-bold">{t('gross')}</dt>
              <dd className="ltr-iso font-bold">{formatEgp(current.grossPiastres)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-caption text-text-muted">
              <dt>{t('insured')}</dt>
              <dd className="ltr-iso">
                {current.insuredWagePiastres === null
                  ? t('insuredIsGross')
                  : formatEgp(current.insuredWagePiastres)}
              </dd>
            </div>
            <div className="text-caption text-text-muted">
              {t('inForceFrom', { date: isoToDayFirst(current.effectiveFrom) })}
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-body-sm text-text-muted">{t('noPackage')}</p>
        )}
        {band && (band.bandMinPiastres != null || band.bandMaxPiastres != null) && (
          <p className="mt-3 rounded-md bg-surface-raised px-3 py-2 text-caption">
            {t('band', {
              grade: locale === 'ar' ? band.nameAr : band.nameEn,
              min: band.bandMinPiastres != null ? formatEgp(band.bandMinPiastres) : '–',
              max: band.bandMaxPiastres != null ? formatEgp(band.bandMaxPiastres) : '–',
            })}
          </p>
        )}
        <p className="mt-3 text-caption text-text-muted">
          {t('packageIntro')}{' '}
          {payrollHref && (
            <a href={payrollHref} className="font-bold text-link">
              {t('payrollLink')}
            </a>
          )}
        </p>
      </section>

      {canEdit && (
        <form
          className="rounded-lg border border-line bg-surface p-4"
          aria-labelledby="pkg-new"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 id="pkg-new" className="text-h3">
            {current ? t('changePackage') : t('setPackage')}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-caption">
              {t('basic')}
              <input
                value={form.basic}
                onChange={(e) => setForm({ ...form, basic: e.target.value })}
                inputMode="decimal"
                dir="ltr"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('insured')}
              <input
                value={form.insured}
                onChange={(e) => setForm({ ...form, insured: e.target.value })}
                inputMode="decimal"
                dir="ltr"
                placeholder={t('insuredIsGross')}
                className={field}
              />
            </label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-caption font-bold">{t('allowances')}</legend>
            <ul className="mt-1 space-y-2">
              {form.lines.map((l, i) => (
                <li key={i} className="grid grid-cols-[1fr_1fr_7rem_auto] items-end gap-2">
                  <select
                    value={l.kind}
                    aria-label={t('allowanceKind')}
                    onChange={(e) => setLine(i, { kind: e.target.value as AllowanceKind })}
                    className={field}
                  >
                    {ALLOWANCE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`allowanceKinds.${k}`)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.label}
                    onChange={(e) => setLine(i, { label: e.target.value })}
                    placeholder={t('allowanceLabel')}
                    aria-label={t('allowanceLabel')}
                    maxLength={60}
                    className={field}
                  />
                  <input
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                    inputMode="decimal"
                    dir="ltr"
                    aria-label={t('amount')}
                    placeholder={t('amount')}
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })
                    }
                    className="h-10 rounded-md border border-line px-3 text-body-sm text-danger"
                    aria-label={t('removeAllowance')}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-body-sm font-bold text-link"
              onClick={() =>
                setForm({
                  ...form,
                  lines: [...form.lines, { kind: 'transport', label: '', amount: '' }],
                })
              }
            >
              + {t('addAllowance')}
            </button>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-caption">
              {t('effectiveFrom')}
              <span className="mt-1 block">
                <DateInput
                  value={form.from}
                  onChange={(e) => setForm({ ...form, from: e.target.value })}
                  className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
                />
              </span>
              <span className="mt-1 block text-text-muted">{t('effectiveHint')}</span>
            </label>
            <label className="block text-caption">
              {t('note')}
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                maxLength={300}
                className={field}
              />
            </label>
          </div>
          <p className="mt-3 flex justify-between rounded-md bg-surface-raised px-3 py-2 text-body">
            <span className="font-bold">{t('gross')}</span>
            <span className="ltr-iso font-bold">{formatEgp(gross)}</span>
          </p>
          {outside && (
            <p className="mt-2 text-body-sm text-status-needs-action">{t('outsideBand')}</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-2 text-body-sm">
              {notice}
            </p>
          )}
          <div className="mt-3">
            <FormFooter
              dirty={dirty}
              busy={busy}
              disabled={!dirty || !valid}
              saveLabel={t('savePackage')}
              onCancel={() => setForm(initial)}
            />
          </div>
        </form>
      )}

      <section
        className="rounded-lg border border-line bg-surface lg:col-span-2"
        aria-labelledby="pkg-hist"
      >
        <h2 id="pkg-hist" className="px-4 pt-4 text-h3">
          {t('packageHistory')}
        </h2>
        {history.length === 0 ? (
          <p className="p-4 text-body-sm text-text-muted">{t('noPackage')}</p>
        ) : (
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[560px] text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('effectiveFrom')}</th>
                  <th className={`${th} text-end`}>{t('basic')}</th>
                  <th className={`${th} text-end`}>{t('allowances')}</th>
                  <th className={`${th} text-end`}>{t('gross')}</th>
                  <th className={th}>{t('note')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2">
                      <span className="ltr-iso">{isoToDayFirst(h.effectiveFrom)}</span>
                      {h.current && (
                        <span className="ms-2 rounded-pill bg-selected-bg px-2 text-caption font-bold text-link">
                          {t('inForce')}
                        </span>
                      )}
                    </td>
                    <td className="ltr-iso px-3 py-2 text-end">{formatEgp(h.basicPiastres)}</td>
                    <td className="ltr-iso px-3 py-2 text-end">
                      {formatEgp(h.grossPiastres - h.basicPiastres)}
                    </td>
                    <td className="ltr-iso px-3 py-2 text-end font-bold">
                      {formatEgp(h.grossPiastres)}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {h.note ?? '–'}
                      <span className="block text-caption">{h.createdBy.name}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
