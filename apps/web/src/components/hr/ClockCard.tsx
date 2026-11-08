'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { cairoHm, hours, type MyAttendance, type MyToday } from '@/lib/attendance-types';

type Problem = { code: string; values?: Record<string, number> };

const KNOWN = [
  'no_position',
  'position_inaccurate',
  'too_far',
  'already_clocked_in',
  'not_clocked_in',
  'office_location_not_set',
  'employee_not_active',
  'location_denied',
  'location_unavailable',
  'location_timeout',
  'no_geolocation',
  'network',
];

/** The phone's position with high accuracy; refusals become our own codes. */
function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation)
      return reject({ code: 'no_geolocation' } satisfies Problem);
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) =>
        reject({
          code:
            error.code === error.PERMISSION_DENIED
              ? 'location_denied'
              : error.code === error.TIMEOUT
                ? 'location_timeout'
                : 'location_unavailable',
        } satisfies Problem),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

/**
 * Clock in and Clock out (docs/HR.md 2), on the store home, the rider home and My HR. The
 * phone's position is sent with every punch and the API checks it against the person's store
 * (or the office). Shows nothing for an account without an employee file.
 */
export function ClockCard({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('attendance');
  const locale = useLocale();
  const [data, setData] = useState<MyAttendance | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/me/attendance', { cache: 'no-store' }).catch(() => null);
    if (!res || res.status === 404 || res.status === 401) return setHidden(true);
    if (res.ok) setData((await res.json()) as MyAttendance);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;
  if (!data)
    return (
      <section
        className="h-[112px] animate-pulse rounded-lg border border-line bg-surface"
        aria-busy="true"
        aria-label={t('title')}
      />
    );

  const today = data.today;
  const place =
    data.place.kind === 'office'
      ? t('office')
      : ((locale === 'ar' ? data.place.nameAr : data.place.nameEn) ?? '');

  function explain(p: Problem) {
    const code = KNOWN.includes(p.code) ? p.code : 'generic';
    return t(`errors.${code}`, {
      place,
      distance: p.values?.distanceM ?? 0,
      radius: p.values?.radiusM ?? data!.place.radiusM,
      accuracy: p.values?.accuracyM ?? 0,
      max: p.values?.maxAccuracyM ?? data!.place.maxAccuracyM,
    });
  }

  async function punch(kind: 'in' | 'out') {
    setBusy(true);
    setMessage({ text: t('locating'), error: false });
    try {
      const pos = await position();
      const res = await fetch(`/api/me/attendance/clock-${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          device: navigator.userAgent.slice(0, 300),
        }),
      }).catch(() => null);
      if (!res) throw { code: 'network' } satisfies Problem;
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        punch?: { at: string };
        today?: MyToday;
      } & Record<string, number>;
      if (!res.ok) throw { code: body.error ?? 'generic', values: body } satisfies Problem;
      setData((d) => (d && body.today ? { ...d, today: { ...d.today, ...body.today } } : d));
      setMessage({
        text: t(kind === 'in' ? 'clockedInAt' : 'clockedOutAt', { time: cairoHm(body.punch?.at) }),
        error: false,
      });
    } catch (error) {
      setMessage({ text: explain(error as Problem), error: true });
    } finally {
      setBusy(false);
    }
  }

  const plan = today.holiday
    ? t('holiday')
    : today.shift
      ? t('shift', { start: cairoHm(today.shift.start), end: cairoHm(today.shift.end) })
      : today.dayOff
        ? t('dayOff')
        : t('noShift');
  // Clocked in on an earlier day (past midnight, no clock out yet): there is no time today.
  const status =
    today.clockedIn && !today.firstIn
      ? t('inSinceEarlier')
      : today.clockedIn
        ? today.late
          ? t('inSinceLate', { time: cairoHm(today.firstIn), late: today.lateMinutes ?? 0 })
          : t('inSince', { time: cairoHm(today.firstIn) })
        : today.lastOut
          ? t('outAt', { time: cairoHm(today.lastOut), worked: hours(today.workedMinutes) })
          : t('notIn');

  return (
    <section
      aria-labelledby="clock-title"
      className={`rounded-lg border bg-surface p-4 ${
        today.clockedIn ? 'border-status-delivered' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${
            today.clockedIn ? 'bg-status-delivered text-white' : 'bg-selected-bg text-link'
          }`}
        >
          <Icon name="schedule" size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="clock-title" className="text-h3">
            {t('title')}
          </h2>
          <p className="text-body-sm text-text-muted">
            <span className="ltr-iso">{plan}</span>
          </p>
          <p className="mt-1 text-body-sm font-bold" role="status">
            {status}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void punch(today.clockedIn ? 'out' : 'in')}
        className={`mt-3 h-12 w-full rounded-md text-body font-bold text-white disabled:opacity-60 ${
          today.clockedIn ? 'bg-text' : 'bg-primary'
        }`}
      >
        {busy ? t('working') : today.clockedIn ? t('clockOut') : t('clockIn')}
      </button>
      {message && (
        <p
          aria-live="polite"
          className={`mt-2 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
      {!compact && (
        <p className="mt-2 text-caption text-text-muted">
          {t('where', { place, radius: data.place.radiusM })}
        </p>
      )}
    </section>
  );
}
