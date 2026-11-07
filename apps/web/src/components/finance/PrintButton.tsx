'use client';

import { useTranslations } from 'next-intl';

/** Opens the browser's print window (save as PDF from there). */
export function PrintButton() {
  const t = useTranslations('finance');
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-primary px-4 py-2 text-body-sm font-bold text-on-primary print:hidden"
    >
      {t('print')}
    </button>
  );
}
