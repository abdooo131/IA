'use client';

import {
  COMPARE_MODES,
  type CompareMode,
  type PeriodPreset,
  PERIOD_PRESETS,
  presetRange,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DateInput } from '@/components/DateInput';
import { presetFor, reportQuery, type ReportState } from '@/lib/report-view';

const field = 'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';

export interface FilterOption {
  id: string;
  label: string;
}

/**
 * The filters every drill down report shares: the period (presets or Cairo days), a
 * comparison, and a store and a merchant. They are written to the address on Apply.
 */
export function ReportFilterBar({
  state,
  today,
  stores,
  merchants,
  asOf = false,
  compare = true,
  extra,
}: {
  state: ReportState;
  today: string;
  stores?: FilterOption[];
  merchants?: FilterOption[];
  /** The balance sheet: one day (the period's last day) instead of a period */
  asOf?: boolean;
  compare?: boolean;
  /** Other params of the page to keep (a tab) */
  extra?: Record<string, string>;
}) {
  const t = useTranslations('finance.drill');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [s, setS] = useState(state);
  const [preset, setPreset] = useState<PeriodPreset>(presetFor(state, today));

  const choose = (p: PeriodPreset) => {
    setPreset(p);
    if (p !== 'custom') setS({ ...s, ...presetRange(p, today) });
  };
  const apply = () =>
    start(() => router.push(`${pathname}?${reportQuery(s, extra)}`, { scroll: false }));

  return (
    <form
      className={`mt-4 grid grid-cols-2 items-end gap-3 rounded-lg border border-line bg-surface p-3 sm:flex sm:flex-wrap ${pending ? 'opacity-70' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="col-span-2 text-caption sm:w-44">
        {t('period')}
        <select
          value={preset}
          onChange={(e) => choose(e.target.value as PeriodPreset)}
          className={field}
        >
          {PERIOD_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`presets.${p}`)}
            </option>
          ))}
        </select>
      </label>
      {!asOf && (
        <label className="text-caption sm:w-40">
          {tf('from')}
          <DateInput
            value={s.from}
            max={today}
            onChange={(e) => {
              setPreset('custom');
              setS({ ...s, from: e.target.value });
            }}
            className={field}
          />
        </label>
      )}
      <label className={`text-caption sm:w-40 ${asOf ? 'col-span-2' : ''}`}>
        {asOf ? t('asOf') : tf('to')}
        <DateInput
          value={s.to}
          max={today}
          onChange={(e) => {
            setPreset('custom');
            setS({ ...s, to: e.target.value });
          }}
          className={field}
        />
      </label>
      {compare && (
        <label className="col-span-2 text-caption sm:w-52">
          {t('compare')}
          <select
            value={s.compare}
            onChange={(e) => setS({ ...s, compare: e.target.value as CompareMode })}
            className={field}
          >
            {COMPARE_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`compareModes.${m}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {stores && (
        <label className="text-caption sm:w-44">
          {t('store')}
          <select
            value={s.store ?? ''}
            onChange={(e) => setS({ ...s, store: e.target.value || null })}
            className={field}
          >
            <option value="">{t('allStores')}</option>
            {stores.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {merchants && (
        <label className="text-caption sm:w-44">
          {t('merchant')}
          <select
            value={s.merchant ?? ''}
            onChange={(e) => setS({ ...s, merchant: e.target.value || null })}
            className={field}
          >
            <option value="">{t('allMerchants')}</option>
            {merchants.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        disabled={pending}
        className="col-span-2 h-10 rounded-md bg-primary px-5 text-body-sm font-bold text-on-primary disabled:opacity-60"
        lang={locale}
      >
        {tf('apply')}
      </button>
    </form>
  );
}
