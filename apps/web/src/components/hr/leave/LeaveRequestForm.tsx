'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { newActionKey } from '@/lib/ids';
import type { LeaveType } from '@/lib/leave-types';
import { area, dateField, Feedback, field, primary, useAction, useName } from './kit';

/**
 * Asks for leave: the person from My HR, or HR for someone (`people` given) with the two
 * overrides HR has (past the balance: the days beyond it are unpaid; further back than allowed).
 * A note (a medical note) can be attached after sending, while the request waits.
 */
export function LeaveRequestForm({
  types,
  people,
}: {
  types: LeaveType[];
  people?: { id: string; code: string; nameEn: string; nameAr: string | null }[];
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [employeeId, setEmployeeId] = useState(people?.length === 1 ? people[0]!.id : '');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [note, setNote] = useState('');
  const [overrideBalance, setOverrideBalance] = useState(false);
  const [overrideBackdate, setOverrideBackdate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(newActionKey);
  const hr = !!people;
  const type = types.find((x) => x.id === typeId);
  const needsDocument = type && type.documentAboveDays !== null;

  async function submit() {
    const body = {
      typeId,
      from,
      to: halfDay ? from : to || from,
      halfDay,
      note: note || null,
      idempotencyKey: key,
      ...(hr && { employeeId, overrideBalance, overrideBackdate }),
    };
    const created = await action.send<{ id: string }>(
      'POST',
      hr ? '/hr/leave/requests' : '/me/leave/requests',
      body,
      t('requestSent'),
    );
    if (!created) return;
    if (file)
      await action.upload(
        `${hr ? '/hr' : '/me'}/leave/requests/${created.id}/document`,
        file,
        t('requestSent'),
      );
    setKey(newActionKey());
    setFrom('');
    setTo('');
    setNote('');
    setHalfDay(false);
    setFile(null);
  }

  return (
    <div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {hr && (
          <label className="block text-caption sm:col-span-2">
            {t('person')}
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className={field}
            >
              <option value="">{t('choosePerson')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {name(p)} ({p.code})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-caption sm:col-span-2">
          {t('type')}
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {name(x)}
                {x.paid ? '' : ` · ${t('unpaid')}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          <span className="block">{t('from')}</span>
          <DateInput className={dateField} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block text-caption">
          <span className="block">{t('to')}</span>
          <DateInput
            className={dateField}
            value={halfDay ? from : to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
          <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
          {t('halfDayOption')}
        </label>
        <label className="block text-caption sm:col-span-2 lg:col-span-4">
          {t('note')}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className={area} />
        </label>
        {needsDocument && (
          <label className="block text-caption sm:col-span-2">
            {type.documentAboveDays === 0
              ? t('documentAlways')
              : t('documentAbove', { days: type.documentAboveDays ?? 0 })}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-body-sm"
            />
          </label>
        )}
        {hr && (
          <div className="grid gap-1 sm:col-span-2">
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={overrideBalance}
                onChange={(e) => setOverrideBalance(e.target.checked)}
              />
              {t('overrideBalance')}
            </label>
            <label className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={overrideBackdate}
                onChange={(e) => setOverrideBackdate(e.target.checked)}
              />
              {t('overrideBackdate')}
            </label>
          </div>
        )}
      </div>
      {type && (
        <p className="mt-2 text-caption text-text-muted">
          {[
            type.noticeDays > 0 && !hr ? t('noticeHint', { days: type.noticeDays }) : null,
            type.maxDaysPerRequest ? t('maxHint', { days: type.maxDaysPerRequest }) : null,
            type.balance === 'none' ? t('noBalanceHint') : t('balanceHint'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <button
        type="button"
        className={`${primary} mt-3`}
        disabled={action.busy || !typeId || !from || (hr && !employeeId)}
        onClick={() => void submit()}
      >
        {t('sendRequest')}
      </button>
      <Feedback error={action.error} done={action.done} />
    </div>
  );
}
