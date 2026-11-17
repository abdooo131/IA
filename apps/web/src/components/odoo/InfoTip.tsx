'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

/** Accountant words in plain language: a small (i) that explains a term on hover, focus or tap. */
export const INFO_TERMS = [
  'journal',
  'trialBalance',
  'receivables',
  'accrual',
  'withholding',
  'balanceSheet',
  'cashFlow',
] as const;
export type InfoTerm = (typeof INFO_TERMS)[number];

export function InfoTip({ term }: { term: InfoTerm }) {
  const t = useTranslations('infoTips');
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={t('label', { term: t(`${term}.term`) })}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ms-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line-strong text-[11px] font-bold leading-none text-text-muted hover:text-text"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute start-0 top-6 z-50 w-64 rounded-md border border-line bg-surface p-2 text-start text-caption font-normal normal-case tracking-normal text-text shadow-lg"
        >
          <strong className="block">{t(`${term}.term`)}</strong>
          {t(`${term}.text`)}
        </span>
      )}
    </span>
  );
}
