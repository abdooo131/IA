'use client';

import { CONTRACT_PRICE_KEYS, type ContractPriceKey, PAYOUT_SCHEDULES } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import {
  bodyFrom,
  type ContractForm,
  type ContractVersion,
  type ContractView,
  formFrom,
  isPercent,
  newTierRow,
} from '@/lib/contracts';
import { newActionKey } from '@/lib/ids';
import { ContractCalculator } from './ContractCalculator';
import { priceText } from './ContractDocument';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';

const KNOWN_ERRORS = [
  'contract_draft_exists',
  'contract_version_not_draft',
  'validation_failed',
] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 text-caption">
      {label}
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-text-muted">{hint}</span>}
    </label>
  );
}

function Fieldset({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-3 border-t border-line pt-4">
      <legend className="pt-2 text-body font-bold">{title}</legend>
      {hint && <p className="text-caption text-text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

/**
 * A new version (or the open draft) of a merchant's contract: every price with the standard
 * one beside it (empty is the standard price), tiers on any fee, payment terms, promises,
 * dates and notes. Saving keeps a draft; nothing changes until it is activated.
 */
export function ContractEditor({
  view,
  base,
  today,
  onDone,
}: {
  view: ContractView;
  /** The draft being changed, or the version a new draft starts from */
  base: ContractVersion | null;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const router = useRouter();
  const editingDraft = base?.status === 'draft';
  const [initial] = useState(() => formFrom(base, today));
  const [form, setForm] = useState<ContractForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newActionKey);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof ContractForm>(k: K, v: ContractForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setPrice = (k: ContractPriceKey, v: string) =>
    setForm((f) => ({ ...f, prices: { ...f.prices, [k]: v } }));
  const setTier = (i: number, k: 'fromOrder' | ContractPriceKey, v: string) =>
    setForm((f) => ({
      ...f,
      tiers: f.tiers.map((row, j) =>
        j !== i
          ? row
          : k === 'fromOrder'
            ? { ...row, fromOrder: v }
            : { ...row, values: { ...row.values, [k]: v } },
      ),
    }));
  const parsed = bodyFrom(form);
  const unit = (k: ContractPriceKey) => (isPercent(k) ? '%' : 'EGP');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!parsed.ok) return setError(t(`errors.${parsed.error}`));
    setBusy(true);
    setError(null);
    const path = `/admin/merchants/${view.merchant.id}/contract/versions`;
    const result = editingDraft
      ? await apiSend('PUT', `${path}/${base!.id}`, parsed.body)
      : await apiSend('POST', path, { ...parsed.body, idempotencyKey: key });
    setBusy(false);
    if (!result.ok)
      return setError(
        t(
          `errors.${(KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'generic'}`,
        ),
      );
    onDone();
    router.refresh();
  }

  const preview =
    parsed.ok &&
    ({
      prices: Object.fromEntries(
        CONTRACT_PRICE_KEYS.map((k) => [k, parsed.body[k] as number | null]),
      ) as ContractVersion['prices'],
      tiers: parsed.body.tiers as ContractVersion['tiers'],
      minimumMonthlyFeePiastres: parsed.body.minimumMonthlyFeePiastres as number | null,
    } satisfies Pick<ContractVersion, 'prices' | 'tiers' | 'minimumMonthlyFeePiastres'>);

  return (
    <form
      onSubmit={(e) => void save(e)}
      className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
      aria-label={t('form.title')}
    >
      <div>
        <h2 className="text-h3">
          {editingDraft ? t('form.editDraft', { label: base!.label }) : t('form.title')}
        </h2>
        <p className="text-body-sm text-text-muted">{t('form.intro')}</p>
      </div>

      <Fieldset title={t('sections.prices')} hint={t('form.pricesHint')}>
        <div className="space-y-2">
          {CONTRACT_PRICE_KEYS.map((k) => (
            <div
              key={k}
              className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div className="text-body-sm">
                {t(`fees.${k}`)}
                <span className="block text-caption text-text-muted">{t(`units.${k}`)}</span>
              </div>
              <p className="text-caption text-text-muted">
                {t('standard')}: <span className="ltr-iso">{priceText(k, view.standard[k])}</span>
              </p>
              <label className="block text-caption">
                <span className="sr-only">
                  {t(`fees.${k}`)} ({unit(k)})
                </span>
                <span className="flex items-center gap-1">
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    value={form.prices[k]}
                    placeholder={t('asStandard')}
                    onChange={(e) => setPrice(k, e.target.value)}
                    className={field}
                    aria-label={t(`fees.${k}`)}
                  />
                  <span className="w-8 shrink-0 text-caption text-text-muted">{unit(k)}</span>
                </span>
              </label>
            </div>
          ))}
          <p className="text-caption text-text-muted">{t('form.vatAndPackaging')}</p>
        </div>
      </Fieldset>

      <Fieldset title={t('sections.tiers')} hint={t('form.tiersHint')}>
        <ul className="space-y-3">
          {form.tiers.map((row, i) => (
            <li key={i} className="space-y-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <Field label={t('fromOrder')}>
                  <input
                    inputMode="numeric"
                    dir="ltr"
                    required
                    value={row.fromOrder}
                    onChange={(e) => setTier(i, 'fromOrder', e.target.value)}
                    className={`${field} max-w-[8rem]`}
                  />
                </Field>
                <button
                  type="button"
                  className="btn-secondary h-10"
                  onClick={() =>
                    set(
                      'tiers',
                      form.tiers.filter((_, j) => j !== i),
                    )
                  }
                >
                  {t('form.removeTier')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CONTRACT_PRICE_KEYS.map((k) => (
                  <Field key={k} label={`${t(`fees.${k}`)} (${unit(k)})`}>
                    <input
                      inputMode="decimal"
                      dir="ltr"
                      value={row.values[k]}
                      placeholder="–"
                      onChange={(e) => setTier(i, k, e.target.value)}
                      className={field}
                    />
                  </Field>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-secondary h-10"
          onClick={() => set('tiers', [...form.tiers, newTierRow(form.tiers)])}
        >
          {t('form.addTier')}
        </button>
      </Fieldset>

      <Fieldset title={t('sections.payment')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('payoutSchedule')} hint={t('form.scheduleHint')}>
            <select
              value={form.payoutSchedule}
              onChange={(e) =>
                set('payoutSchedule', e.target.value as ContractForm['payoutSchedule'])
              }
              className={field}
            >
              <option value="">{t('ownChoice')}</option>
              {PAYOUT_SCHEDULES.map((s) => (
                <option key={s} value={s}>
                  {t(`schedules.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`${t('minimumPayout')} (EGP)`}
            hint={t('form.standardIs', {
              value: `${(view.standardTerms.minimumPayoutPiastres / 100).toFixed(2)} EGP`,
            })}
          >
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.minimumPayout}
              placeholder={t('asStandard')}
              onChange={(e) => set('minimumPayout', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={`${t('minimumFee')} (EGP)`} hint={t('minimumFeeHint')}>
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.minimumMonthlyFee}
              placeholder={t('none')}
              onChange={(e) => set('minimumMonthlyFee', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={`${t('deposit')} (EGP)`}>
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.securityDeposit}
              placeholder={t('none')}
              onChange={(e) => set('securityDeposit', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={`${t('creditLimit')} (EGP)`} hint={t('creditLimitHint')}>
            <input
              inputMode="decimal"
              dir="ltr"
              value={form.creditLimit}
              placeholder={t('none')}
              onChange={(e) => set('creditLimit', e.target.value)}
              className={field}
            />
          </Field>
        </div>
        <p className="text-caption text-text-muted">{t('form.bankHint')}</p>
      </Fieldset>

      <Fieldset title={t('sections.promises')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('promise')}
            hint={t('form.standardIs', {
              value: t('minutes', { n: view.standardTerms.promiseMinutes }),
            })}
          >
            <input
              inputMode="numeric"
              dir="ltr"
              value={form.promiseMinutes}
              placeholder={t('asStandard')}
              onChange={(e) => set('promiseMinutes', e.target.value)}
              className={field}
            />
          </Field>
          <Field
            label={t('attempts')}
            hint={t('form.attemptsHint', { n: view.standardTerms.deliveryAttempts })}
          >
            <input
              inputMode="numeric"
              dir="ltr"
              value={form.deliveryAttempts}
              placeholder={t('asStandard')}
              onChange={(e) => set('deliveryAttempts', e.target.value)}
              className={field}
            />
          </Field>
        </div>
        <div>
          <p className="text-caption">{t('stores')}</p>
          <p className="text-caption text-text-muted">{t('form.storesHint')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {view.stores.map((s) => {
              const on = form.storeIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex h-10 items-center gap-2 rounded-md border px-3 text-body-sm ${on ? 'border-primary' : 'border-line'}`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      set(
                        'storeIds',
                        on ? form.storeIds.filter((x) => x !== s.id) : [...form.storeIds, s.id],
                      )
                    }
                  />
                  {locale === 'ar' ? s.nameAr : s.nameEn}
                </label>
              );
            })}
          </div>
        </div>
        <Field label={t('areas')}>
          <input
            maxLength={500}
            value={form.coverageNote}
            onChange={(e) => set('coverageNote', e.target.value)}
            className={field}
          />
        </Field>
      </Fieldset>

      <Fieldset title={t('sections.dates')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('start')}>
            <DateInput
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={t('form.endOptional')}>
            <DateInput
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={t('form.noticeDays')}>
            <input
              inputMode="numeric"
              dir="ltr"
              required
              value={form.noticeDays}
              onChange={(e) => set('noticeDays', e.target.value)}
              className={field}
            />
          </Field>
          <Field label={t('form.plannedFrom')} hint={t('form.plannedFromHint')}>
            <DateInput
              value={form.effectiveFrom}
              onChange={(e) => set('effectiveFrom', e.target.value)}
              className={field}
            />
          </Field>
        </div>
      </Fieldset>

      <Fieldset title={t('sections.terms')}>
        <Field label={t('form.termsLabel')} hint={t('form.termsHint')}>
          <textarea
            maxLength={4000}
            rows={4}
            value={form.terms}
            onChange={(e) => set('terms', e.target.value)}
            className="w-full rounded-md border border-line-strong bg-surface p-2 text-body-sm"
          />
        </Field>
        <Field label={t('sections.internal')}>
          <textarea
            maxLength={1000}
            rows={2}
            value={form.internalNote}
            onChange={(e) => set('internalNote', e.target.value)}
            className="w-full rounded-md border border-line-strong bg-surface p-2 text-body-sm"
          />
        </Field>
      </Fieldset>

      {preview ? (
        <ContractCalculator version={preview} standard={view.standard} vatBp={view.vatBp} />
      ) : (
        <p role="alert" className="text-body-sm text-danger">
          {t(`errors.${(parsed as { error: string }).error}`)}
        </p>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter dirty={dirty} busy={busy} saveLabel={t('form.save')} onCancel={onDone} />
    </form>
  );
}
