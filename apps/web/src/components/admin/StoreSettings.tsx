'use client';

import { formatMinute, parseMinute } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AdminStore } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';

const input = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm text-text';
const secondary =
  'h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';

function useSaver() {
  const t = useTranslations('admin.zones');
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });
  async function save(method: 'PUT', path: string, body: unknown) {
    setState({ busy: true, message: null, error: false });
    const result = await apiSend(method, path, body);
    if (result.ok) {
      setState({ busy: false, message: t('saved'), error: false });
      router.refresh();
    } else {
      const key = ['validation_failed', 'network'].includes(result.error)
        ? result.error
        : 'generic';
      setState({ busy: false, message: t(`errors.${key}`), error: true });
    }
  }
  return { ...state, save };
}

function Feedback({ message, error }: { message: string | null; error: boolean }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-body-sm ${error ? 'text-danger' : 'text-text-muted'}`}>
      {message}
    </p>
  );
}

export function HoursForm({ store }: { store: AdminStore }) {
  const t = useTranslations('admin.zones');
  const weekdays = useTranslations('weekdays');
  const saver = useSaver();
  const [rows, setRows] = useState(() =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = store.hours.find((h) => h.weekday === weekday);
      return {
        weekday,
        opens: formatMinute(day?.opensMinute ?? 600),
        closes: formatMinute(day?.closesMinute ?? 1440),
        isClosed: day?.isClosed ?? false,
      };
    }),
  );

  const update = (weekday: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));

  function submit() {
    const week = rows.map((r) => {
      const opensMinute = parseMinute(r.opens) ?? 0;
      let closesMinute = parseMinute(r.closes) ?? 0;
      // A closing time at or before the opening time means after midnight.
      if (closesMinute <= opensMinute) closesMinute += 1440;
      return { weekday: r.weekday, opensMinute, closesMinute, isClosed: r.isClosed };
    });
    void saver.save('PUT', `/admin/dark-stores/${store.id}/hours`, week);
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-body font-bold">{t('hours')}</h3>
      <table className="mt-3 w-full text-body-sm">
        <thead>
          <tr className="text-caption text-text-muted">
            <th className="py-1 text-start font-medium">{t('day')}</th>
            <th className="py-1 text-start font-medium">{t('opens')}</th>
            <th className="py-1 text-start font-medium">{t('closes')}</th>
            <th className="py-1 text-start font-medium">{t('closedDay')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Closing at 00:00 is plain midnight; only later times need the "next day" note.
            const closes = parseMinute(r.closes) ?? 0;
            const overnight = closes > 0 && closes <= (parseMinute(r.opens) ?? 0);
            return (
              <tr key={r.weekday}>
                <td className="py-1 pe-2">{weekdays(String(r.weekday))}</td>
                <td className="py-1 pe-2">
                  <input
                    type="time"
                    dir="ltr"
                    aria-label={`${weekdays(String(r.weekday))} ${t('opens')}`}
                    className={input}
                    value={r.opens}
                    disabled={r.isClosed}
                    onChange={(e) => update(r.weekday, { opens: e.target.value })}
                  />
                </td>
                <td className="py-1 pe-2">
                  <input
                    type="time"
                    dir="ltr"
                    aria-label={`${weekdays(String(r.weekday))} ${t('closes')}`}
                    className={input}
                    value={r.closes}
                    disabled={r.isClosed}
                    onChange={(e) => update(r.weekday, { closes: e.target.value })}
                  />
                  {overnight && !r.isClosed && (
                    <span className="ms-1 text-caption text-text-muted">{t('nextDay')}</span>
                  )}
                </td>
                <td className="py-1">
                  <input
                    type="checkbox"
                    aria-label={`${weekdays(String(r.weekday))} ${t('closedDay')}`}
                    className="h-5 w-5"
                    checked={r.isClosed}
                    onChange={(e) => update(r.weekday, { isClosed: e.target.checked })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={secondary} disabled={saver.busy} onClick={submit}>
          {t('saveHours')}
        </button>
        <Feedback message={saver.message} error={saver.error} />
      </div>
    </section>
  );
}

export function CapacityForm({ store }: { store: AdminStore }) {
  const t = useTranslations('admin.zones');
  const saver = useSaver();
  const [value, setValue] = useState(String(store.capacityPerHour));
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-body font-bold">{t('capacity')}</h3>
      <p className="mt-1 text-body-sm text-text-muted">{t('capacityHelp')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          dir="ltr"
          aria-label={t('capacity')}
          className={`${input} w-28`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className={secondary}
          disabled={saver.busy}
          onClick={() =>
            void saver.save('PUT', `/admin/dark-stores/${store.id}/capacity`, {
              value: Number(value),
            })
          }
        >
          {t('saveCapacity')}
        </button>
        <Feedback message={saver.message} error={saver.error} />
      </div>
    </section>
  );
}
