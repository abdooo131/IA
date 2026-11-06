'use client';

import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';

const KNOWN = [
  'status_unchanged',
  'cannot_leave_self',
  'left_before_hire',
  'last_owner',
  'validation_failed',
];

/** HR manage: active, on leave, suspended, or left with the last day and the reason. */
export function EmployeeStatusPanel({
  employeeId,
  status,
  today,
}: {
  employeeId: string;
  status: EmployeeStatus;
  today: string;
}) {
  const t = useTranslations('hr');
  const router = useRouter();
  const [next, setNext] = useState<EmployeeStatus>(status);
  const [leftOn, setLeftOn] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (next === 'left' && !window.confirm(t('leftConfirm'))) return;
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/hr/employees/${employeeId}/status`, {
      status: next,
      ...(next === 'left' && { leftOn }),
      ...(reason.trim() && { reason: reason.trim() }),
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setReason('');
    router.refresh();
  }

  return (
    <section className="mt-4 max-w-3xl rounded-lg border border-line p-4" aria-labelledby="status">
      <h2 id="status" className="text-h3">
        {t('changeStatus')}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-caption">
          {t('status')}
          <select
            value={next}
            onChange={(e) => setNext(e.target.value as EmployeeStatus)}
            className={field}
          >
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {next === 'left' && (
          <label className="block text-caption">
            {t('fields.leftOn')}
            <span className="mt-1 block">
              <DateInput
                value={leftOn}
                onChange={(e) => setLeftOn(e.target.value)}
                className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
              />
            </span>
          </label>
        )}
        <label className="block text-caption">
          {t(next === 'left' ? 'fields.leftReason' : 'fields.statusNote')}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            required={next === 'left'}
            className={field}
          />
        </label>
      </div>
      {next === 'left' && <p className="mt-2 text-caption text-text-muted">{t('leftHint')}</p>}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        className={`${primary} mt-3`}
        disabled={busy || next === status || (next === 'left' && reason.trim().length < 2)}
        onClick={() => void save()}
      >
        {t('saveStatus')}
      </button>
    </section>
  );
}
