'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { personName, type Roster, type ShiftRow } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';

const OFF = 'off';
const NONE = '';
const cellSelect =
  'h-10 w-full min-w-[128px] rounded-md border border-line bg-surface px-1 text-caption text-text';

const shiftLabel = (s: ShiftRow, locale: string) =>
  `${locale === 'ar' && s.nameAr ? s.nameAr : s.nameEn} \u2066${s.start}–${s.end}\u2069`; // times kept left to right in Arabic

/**
 * The roster grid: one row per person, one column per day. HR use changes a day (a shift or a
 * day off) and the default shift the coming weeks are generated from; others only read it.
 */
export function RosterGrid({
  roster,
  storeId,
  canEdit,
}: {
  roster: Roster;
  storeId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations('attendance');
  const tw = useTranslations('weekdays');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const active = roster.shifts.filter((s) => s.isActive);
  const holidays = new Map(roster.holidays.map((h) => [h.day, h]));

  async function run(method: 'PUT' | 'PATCH' | 'POST', path: string, body: unknown) {
    setBusy(true);
    const result = await apiSend(method, path, body);
    setBusy(false);
    setMessage(
      result.ok
        ? { text: t('savedFix'), error: false }
        : {
            text: t(
              `fixErrors.${result.error === 'store_not_allowed' ? 'store_not_allowed' : 'generic'}`,
            ),
            error: true,
          },
    );
    if (result.ok) router.refresh();
  }

  const th = 'px-2 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-2 py-2 align-top';
  return (
    <>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run('POST', '/hr/roster/generate', { week: roster.from, darkStoreId: storeId })
            }
            className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold"
          >
            {t('generate')}
          </button>
          <span className="text-caption text-text-muted">{t('generateHint')}</span>
        </div>
      )}
      {message && (
        <p
          role="status"
          className={`mt-2 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
      {roster.people.length === 0 ? (
        <p className="mt-6 text-body">{t('nobody')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[980px] text-body-sm">
            <caption className="sr-only">{t('rosterTitle')}</caption>
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th scope="col" className={th}>
                  {t('columns.person')}
                </th>
                <th scope="col" className={th}>
                  {t('defaultShift')}
                </th>
                {roster.days.map((d) => {
                  const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
                  const h = holidays.get(d);
                  return (
                    <th key={d} scope="col" className={th}>
                      <span className="block">{tw(String(weekday))}</span>
                      <span className="ltr-iso block normal-case">
                        {isoToDayFirst(d).slice(0, 5)}
                      </span>
                      {h && (
                        <span className="block normal-case text-status-needs-action">
                          {locale === 'ar' ? h.nameAr : h.nameEn}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roster.people.map((p) => (
                <tr key={p.id}>
                  <td className={td}>
                    <span className="font-bold">{personName(p, locale)}</span>
                    <span className="ltr-iso block text-caption text-text-muted">{p.code}</span>
                  </td>
                  <td className={td}>
                    {canEdit ? (
                      <select
                        aria-label={t('defaultShiftOf', { name: personName(p, locale) })}
                        value={p.defaultShiftId ?? NONE}
                        disabled={busy}
                        onChange={(e) =>
                          void run('PATCH', `/hr/employees/${p.id}/default-shift`, {
                            shiftId: e.target.value || null,
                          })
                        }
                        className={cellSelect.replace('min-w-[128px]', 'min-w-[168px]')}
                      >
                        <option value={NONE}>{t('noDefault')}</option>
                        {active.map((s) => (
                          <option key={s.id} value={s.id}>
                            {shiftLabel(s, locale)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (active.find((s) => s.id === p.defaultShiftId)?.nameEn ?? '–')
                    )}
                  </td>
                  {p.cells.map((c, i) => {
                    const day = roster.days[i]!;
                    const value = !c ? NONE : c.shiftId ? c.shiftId : OFF;
                    const text = !c ? '–' : c.shiftId ? `${c.start}–${c.end}` : t('dayOff');
                    return (
                      <td key={day} className={`${td} ${c?.edited ? 'bg-selected-bg' : ''}`}>
                        {canEdit ? (
                          <select
                            aria-label={t('cellOf', {
                              name: personName(p, locale),
                              day: isoToDayFirst(day),
                            })}
                            value={value}
                            disabled={busy}
                            onChange={(e) =>
                              void run('PUT', '/hr/roster', {
                                employeeId: p.id,
                                day,
                                shiftId: e.target.value === OFF ? null : e.target.value,
                              })
                            }
                            dir="ltr"
                            className={cellSelect}
                          >
                            {!c && <option value={NONE}>–</option>}
                            <option value={OFF}>{t('dayOff')}</option>
                            {active.map((s) => (
                              <option key={s.id} value={s.id}>
                                {`${s.start}–${s.end}`}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="ltr-iso">{text}</span>
                        )}
                        {p.leave?.[i] && (
                          <span className="mt-1 block rounded-sm bg-primary px-1 text-caption font-bold text-on-primary">
                            {t('onLeaveCell', {
                              type: locale === 'ar' ? p.leave[i]!.nameAr : p.leave[i]!.nameEn,
                            })}
                            {p.leave[i]!.fraction < 1 && ' ½'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-caption text-text-muted">{t('editedHint')}</p>
    </>
  );
}
