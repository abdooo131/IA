'use client';

import { addDays, cairoDay } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { isoToDayFirst } from '@/lib/day-first';
import type { FinanceControls } from '@/lib/finance-types';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';

/** Close the books through a day; moving the date back (reopening) is for admin, with a reason. */
export function CloseBooks({ lock, isAdmin }: { lock: FinanceControls['lock']; isAdmin: boolean }) {
  const t = useTranslations('finance.close');
  const tf = useTranslations('finance.merchants.errors');
  const action = useFinanceAction();
  const yesterday = addDays(cairoDay(new Date()), -1);
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const reopening = !!lock && !!day && day < lock.closedThrough;
  // The calendar stops at yesterday; a day typed past it is refused here, before the API.
  const notOver = !!day && day > yesterday;
  return (
    <div className="mt-4 max-w-xl space-y-4 rounded-lg border border-line bg-surface p-5">
      <p className="text-body">
        {lock
          ? t('closedThrough', { day: isoToDayFirst(lock.closedThrough), name: lock.updatedBy })
          : t('nothingClosed')}
      </p>
      <label className="block text-caption">
        {t('closeThrough')}
        <span className="mt-1 block">
          <DateInput
            value={day}
            max={yesterday}
            onChange={(e) => setDay(e.target.value)}
            className={field}
          />
        </span>
        {notOver && (
          <span role="alert" className="mt-1 block text-body-sm text-danger">
            {tf('day_not_over')}
          </span>
        )}
      </label>
      {reopening && (
        <label className="block text-caption">
          {isAdmin ? t('reason') : t('adminOnly')}
          {isAdmin && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${field} mt-1 w-full`}
            />
          )}
        </label>
      )}
      <button
        type="button"
        disabled={
          action.busy || !day || notOver || (reopening && (!isAdmin || reason.trim().length < 5))
        }
        onClick={() =>
          void action.send('POST', '/finance/books-lock', { day, reason: reason || undefined })
        }
        className="h-11 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
      >
        {reopening ? t('reopen') : t('close')}
      </button>
      <p className="text-caption text-text-muted">{t('hint')}</p>
      <ActionMessage message={action.message} />
    </div>
  );
}
