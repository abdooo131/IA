'use client';

import { ATTENDANCE_STATUSES, cairoAt, parseMinute } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { cairoHm, type DayDetail } from '@/lib/attendance-types';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50';
const KNOWN = [
  'punch_in_future',
  'store_not_allowed',
  'punch_already_voided',
  'day_in_future',
  'validation_failed',
];

/**
 * A manager's corrections (HR use): add a punch the phone could not make, void a wrong one, or
 * set the day's status. Every change needs a reason and is kept in the person's history.
 */
export function DayCorrections({ detail }: { detail: DayDetail }) {
  const t = useTranslations('attendance');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [time, setTime] = useState('');
  const [nextDay, setNextDay] = useState(false);
  const [punchReason, setPunchReason] = useState('');
  const [status, setStatus] = useState(detail.row?.overrideStatus ?? '');
  const [statusReason, setStatusReason] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  async function send(path: string, body: unknown) {
    setBusy(true);
    const result = await apiSend('POST', path, body);
    setBusy(false);
    if (!result.ok) {
      const code = KNOWN.includes(result.error) ? result.error : 'generic';
      setMessage({ text: t(`fixErrors.${code}`), error: true });
      return false;
    }
    setMessage({ text: t('savedFix'), error: false });
    router.refresh();
    return true;
  }

  async function addPunch() {
    const minute = parseMinute(time);
    if (minute === null || punchReason.trim().length < 3)
      return setMessage({ text: t('fixErrors.validation_failed'), error: true });
    const at = cairoAt(detail.day, minute + (nextDay ? 1440 : 0)).toISOString();
    if (
      await send('/hr/attendance/punches', {
        employeeId: detail.employee.id,
        kind,
        at,
        reason: punchReason.trim(),
      })
    ) {
      setTime('');
      setPunchReason('');
    }
  }

  async function saveStatus() {
    if (statusReason.trim().length < 3)
      return setMessage({ text: t('fixErrors.validation_failed'), error: true });
    if (
      await send('/hr/attendance/days/status', {
        employeeId: detail.employee.id,
        day: detail.day,
        status: status || null,
        reason: statusReason.trim(),
      })
    )
      setStatusReason('');
  }

  async function voidOne(id: string) {
    if (voidReason.trim().length < 3)
      return setMessage({ text: t('fixErrors.validation_failed'), error: true });
    if (await send(`/hr/attendance/punches/${id}/void`, { reason: voidReason.trim() })) {
      setVoiding(null);
      setVoidReason('');
    }
  }

  const live = detail.punches.filter((p) => !p.voided);
  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-4" aria-labelledby="fix">
      <h2 id="fix" className="text-h3">
        {t('corrections')}
      </h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('correctionsHint')}</p>

      <fieldset className="mt-4 grid gap-2 sm:grid-cols-4">
        <legend className="text-body-sm font-bold">{t('addPunch')}</legend>
        <label className="block text-caption">
          {t('columns.kind')}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'in' | 'out')}
            className={field}
          >
            <option value="in">{t('kinds.in')}</option>
            <option value="out">{t('kinds.out')}</option>
          </select>
        </label>
        <label className="block text-caption">
          {t('columns.time')}
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="09:30"
            dir="ltr"
            inputMode="numeric"
            className={field}
          />
        </label>
        <label className="block text-caption sm:col-span-2">
          {t('reason')}
          <input
            value={punchReason}
            onChange={(e) => setPunchReason(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2 text-body-sm sm:col-span-3">
          <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} />
          {t('nextDay')}
        </label>
        <div>
          <button type="button" disabled={busy} onClick={() => void addPunch()} className={button}>
            {t('addPunchButton')}
          </button>
        </div>
      </fieldset>

      {live.length > 0 && (
        <fieldset className="mt-5">
          <legend className="text-body-sm font-bold">{t('voidPunch')}</legend>
          <ul className="mt-2 divide-y divide-line">
            {live.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="ltr-iso w-16">{cairoHm(p.at)}</span>
                <span className="w-24">{t(`kinds.${p.kind}`)}</span>
                {voiding === p.id ? (
                  <>
                    <input
                      value={voidReason}
                      onChange={(e) => setVoidReason(e.target.value)}
                      placeholder={t('reason')}
                      aria-label={t('reason')}
                      className={`${field} max-w-xs`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void voidOne(p.id)}
                      className="h-10 rounded-md border border-danger px-3 text-body-sm font-bold text-danger"
                    >
                      {t('voidConfirm')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVoiding(p.id)}
                    className="h-10 rounded-md border border-line px-3 text-body-sm"
                  >
                    {t('voidButton')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <fieldset className="mt-5 grid gap-2 sm:grid-cols-4">
        <legend className="text-body-sm font-bold">{t('setStatus')}</legend>
        <label className="block text-caption">
          {t('columns.status')}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
            <option value="">{t('computedStatus')}</option>
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption sm:col-span-2">
          {t('reason')}
          <input
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            className={field}
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveStatus()}
            className={button}
          >
            {t('saveStatus')}
          </button>
        </div>
      </fieldset>

      {message && (
        <p
          role="status"
          className={`mt-3 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
