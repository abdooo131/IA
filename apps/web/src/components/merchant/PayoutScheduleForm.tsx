'use client';

import { PAYOUT_SCHEDULES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import type { PayoutSchedule } from '@/lib/finance-types';

/** The merchant picks how often finance pays them. */
export function PayoutScheduleForm({ schedule }: { schedule: PayoutSchedule }) {
  const t = useTranslations('merchantFinance');
  const tf = useTranslations('finance');
  const router = useRouter();
  const [value, setValue] = useState(schedule);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function choose(next: PayoutSchedule) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setMessage(null);
    const result = await apiSend('PATCH', '/merchant/finance/payout-schedule', {
      payoutSchedule: next,
    });
    setBusy(false);
    if (!result.ok) {
      setValue(previous);
      setMessage({ text: t('scheduleError'), error: true });
      return;
    }
    setMessage({ text: t('scheduleSaved'), error: false });
    router.refresh();
  }

  return (
    <fieldset disabled={busy}>
      <legend className="text-body-sm font-bold">{t('scheduleTitle')}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {PAYOUT_SCHEDULES.map((s) => (
          <label
            key={s}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
              value === s
                ? 'border-primary bg-selected-bg font-bold text-link'
                : 'border-line bg-surface'
            }`}
          >
            <input
              type="radio"
              name="payoutSchedule"
              value={s}
              checked={value === s}
              onChange={() => void choose(s)}
              className="accent-[var(--shiply-primary)]"
            />
            {tf(`schedules.${s}`)}
          </label>
        ))}
      </div>
      {message && (
        <p
          role="status"
          className={`mt-2 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </fieldset>
  );
}
