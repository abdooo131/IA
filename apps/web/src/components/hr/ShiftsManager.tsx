'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { ShiftRow } from '@/lib/attendance-types';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['shift_crosses_midnight', 'shift_empty', 'validation_failed'];

interface Draft {
  nameEn: string;
  nameAr: string;
  start: string;
  end: string;
  breakMinutes: string;
  weekdays: number[];
  overnight: boolean;
  isActive: boolean;
}
const EMPTY: Draft = {
  nameEn: '',
  nameAr: '',
  start: '10:00',
  end: '16:00',
  breakMinutes: '30',
  weekdays: [0, 1, 2, 3, 4, 6],
  overnight: false,
  isActive: true,
};

/** Shift templates: the list for everyone with HR view, the form for HR manage. */
export function ShiftsManager({ shifts, canEdit }: { shifts: ShiftRow[]; canEdit: boolean }) {
  const t = useTranslations('attendance');
  const tw = useTranslations('weekdays');
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function edit(s: ShiftRow | null) {
    setMessage(null);
    setEditing(s ? s.id : 'new');
    setDraft(
      s
        ? {
            nameEn: s.nameEn,
            nameAr: s.nameAr ?? '',
            start: s.start,
            end: s.end,
            breakMinutes: String(s.breakMinutes),
            weekdays: s.weekdays,
            overnight: s.overnight,
            isActive: s.isActive,
          }
        : EMPTY,
    );
  }

  async function save() {
    setBusy(true);
    const body = {
      ...draft,
      nameAr: draft.nameAr || null,
      breakMinutes: Number(draft.breakMinutes) || 0,
    };
    const result =
      editing === 'new'
        ? await apiSend('POST', '/hr/shifts', body)
        : await apiSend('PUT', `/hr/shifts/${editing}`, body);
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t(`shiftErrors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
    setEditing(null);
    setMessage({ text: t('savedFix'), error: false });
    router.refresh();
  }

  const days = (list: number[]) => list.map((d) => tw(String(d)).slice(0, 3)).join(' · ');
  return (
    <>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {shifts.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-h3">
                  {locale === 'ar' && s.nameAr ? s.nameAr : s.nameEn}
                  {!s.isActive && (
                    <span className="ms-2 text-caption text-text-muted">{t('inactive')}</span>
                  )}
                </h2>
                <p className="ltr-iso text-body-sm">
                  {s.start} – {s.end}
                  {s.overnight ? ` (${t('overnight')})` : ''}
                </p>
                <p className="text-caption text-text-muted">
                  {t('breakMinutes', { minutes: s.breakMinutes })} · {days(s.weekdays)}
                </p>
                <p className="text-caption text-text-muted">
                  {t('peopleOnShift', { count: s.employees })}
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => edit(s)}
                  className="h-10 rounded-md border border-line px-3 text-body-sm"
                >
                  {t('edit')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {shifts.length === 0 && <p className="mt-4 text-body">{t('noShifts')}</p>}

      {canEdit && editing === null && (
        <button
          type="button"
          onClick={() => edit(null)}
          className="mt-4 h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
        >
          {t('newShift')}
        </button>
      )}

      {canEdit && editing !== null && (
        <section className="mt-4 max-w-2xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{editing === 'new' ? t('newShift') : t('editShift')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-caption">
              {t('nameEn')}
              <input
                value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('nameAr')}
              <input
                value={draft.nameAr}
                dir="rtl"
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('starts')}
              <input
                value={draft.start}
                dir="ltr"
                placeholder="10:00"
                onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('ends')}
              <input
                value={draft.end}
                dir="ltr"
                placeholder="16:00"
                onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('breakLabel')}
              <input
                value={draft.breakMinutes}
                dir="ltr"
                inputMode="numeric"
                onChange={(e) => setDraft({ ...draft, breakMinutes: e.target.value })}
                className={field}
              />
            </label>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={draft.overnight}
                  onChange={(e) => setDraft({ ...draft, overnight: e.target.checked })}
                />
                {t('overnightLabel')}
              </label>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                />
                {t('activeLabel')}
              </label>
            </div>
          </div>
          <fieldset className="mt-3">
            <legend className="text-caption">{t('workDays')}</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                <label key={d} className="flex items-center gap-1 text-body-sm">
                  <input
                    type="checkbox"
                    checked={draft.weekdays.includes(d)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        weekdays: e.target.checked
                          ? [...draft.weekdays, d]
                          : draft.weekdays.filter((x) => x !== d),
                      })
                    }
                  />
                  {tw(String(d))}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="h-10 rounded-md bg-primary px-5 text-body-sm font-bold text-on-primary disabled:opacity-50"
            >
              {t('save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="h-10 rounded-md border border-line px-4 text-body-sm"
            >
              {t('cancel')}
            </button>
          </div>
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
