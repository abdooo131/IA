'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import type { HolidayRow } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** The year's official holidays; HR manage adds and removes them. */
export function HolidaysManager({
  holidays,
  canEdit,
}: {
  holidays: HolidayRow[];
  canEdit: boolean;
}) {
  const t = useTranslations('attendance');
  const locale = useLocale();
  const router = useRouter();
  const [day, setDay] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run(method: 'POST' | 'DELETE', path: string, body?: unknown) {
    setBusy(true);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok) {
      const code = ['holiday_exists', 'validation_failed'].includes(result.error)
        ? result.error
        : 'generic';
      setMessage({ text: t(`holidayErrors.${code}`), error: true });
      return false;
    }
    setMessage({ text: t('savedFix'), error: false });
    router.refresh();
    return true;
  }

  return (
    <>
      {holidays.length === 0 ? (
        <p className="mt-4 text-body">{t('noHolidays')}</p>
      ) : (
        <ul className="mt-4 max-w-2xl divide-y divide-line rounded-lg border border-line bg-surface">
          {holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span>
                <span className="ltr-iso font-bold">{isoToDayFirst(h.day)}</span>{' '}
                {locale === 'ar' ? h.nameAr : h.nameEn}
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run('DELETE', `/hr/holidays/${h.id}`)}
                  className="h-10 rounded-md border border-line px-3 text-body-sm"
                >
                  {t('remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <section className="mt-4 max-w-2xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('addHoliday')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-caption">
              {t('columns.day')}
              <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="block text-caption">
              {t('nameEn')}
              <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={field} />
            </label>
            <label className="block text-caption">
              {t('nameAr')}
              <input
                value={nameAr}
                dir="rtl"
                onChange={(e) => setNameAr(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run('POST', '/hr/holidays', { day, nameEn, nameAr })) {
                setDay('');
                setNameEn('');
                setNameAr('');
              }
            }}
            className="mt-3 h-10 rounded-md bg-primary px-5 text-body-sm font-bold text-on-primary disabled:opacity-50"
          >
            {t('add')}
          </button>
        </section>
      )}
      {message && (
        <p
          role="status"
          className={`mt-3 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
