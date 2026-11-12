'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiGetClient } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import type { ViolationStep, ViolationType } from '@/lib/leave-types';
import { parseEgp } from '@/lib/money';
import { area, dateField, Feedback, field, primary, useAction, useName } from './kit';
import { PenaltyText } from './ViolationsTable';

/**
 * HR records a violation: the ladder picks the step from the person's earlier ones of the type
 * in the period (shown before saving); HR may choose another step with a reason. A deduction in
 * EGP entered when recording (cash shortage, damage) asks for the amount. Evidence (a photo or
 * PDF) is attached after saving.
 */
export function RecordViolationForm({
  types,
  people,
  today,
}: {
  types: ViolationType[];
  people: { id: string; code: string; nameEn: string; nameAr: string | null }[];
  today: string;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [employeeId, setEmployeeId] = useState(people.length === 1 ? people[0]!.id : '');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState('');
  const [step, setStep] = useState('');
  const [stepReason, setStepReason] = useState('');
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(newActionKey);
  const [next, setNext] = useState<{ step: number; prior: number; penalty: ViolationStep } | null>(
    null,
  );
  const type = types.find((x) => x.id === typeId);

  useEffect(() => {
    setNext(null);
    if (!employeeId || !typeId || !occurredOn) return;
    let live = true;
    void apiGetClient<{ step: number; prior: number; penalty: ViolationStep }>(
      `/hr/violations/next-step?employeeId=${employeeId}&typeId=${typeId}&occurredOn=${occurredOn}`,
    ).then((r) => {
      if (live && r.ok) setNext(r.data);
    });
    return () => {
      live = false;
    };
  }, [employeeId, typeId, occurredOn]);

  const chosen = type?.steps.find((s) => s.step === (step ? Number(step) : next?.step));
  const needsAmount = chosen?.penalty === 'deduction_amount' && chosen.amountPiastres === null;
  const changed = step !== '' && next !== null && Number(step) !== next.step;

  async function submit() {
    const created = await action.send<{ id: string }>(
      'POST',
      '/hr/violations',
      {
        employeeId,
        typeId,
        occurredOn,
        description,
        idempotencyKey: key,
        ...(changed && { step: Number(step), stepReason }),
        ...(needsAmount && { amountPiastres: parseEgp(amount) ?? 0 }),
      },
      t('recorded'),
    );
    if (!created) return;
    if (file) await action.upload(`/hr/violations/${created.id}/evidence`, file, t('recorded'));
    setKey(newActionKey());
    setDescription('');
    setStep('');
    setStepReason('');
    setAmount('');
    setFile(null);
  }

  return (
    <div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <label className="block text-caption">
          {t('violation')}
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {name(x)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          <span className="block">{t('date')}</span>
          <DateInput
            className={dateField}
            value={occurredOn}
            max={today}
            onChange={(e) => setOccurredOn(e.target.value)}
          />
        </label>
        <label className="block text-caption sm:col-span-2 lg:col-span-4">
          {t('description')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={area}
          />
        </label>
        {next && type && (
          <p className="rounded-md bg-selected-bg p-3 text-body-sm sm:col-span-2 lg:col-span-4">
            {t('ladderSays', { step: next.step, prior: next.prior })}{' '}
            <strong>
              <PenaltyText p={next.penalty} />
            </strong>
          </p>
        )}
        {type && type.steps.length > 1 && (
          <label className="block text-caption">
            {t('changeStep')}
            <select value={step} onChange={(e) => setStep(e.target.value)} className={field}>
              <option value="">{t('ladderStep')}</option>
              {type.steps.map((s) => (
                <option key={s.step} value={s.step}>
                  {t('stepOf', { step: s.step })}
                </option>
              ))}
            </select>
          </label>
        )}
        {changed && (
          <label className="block text-caption sm:col-span-2">
            {t('stepReason')}
            <input
              value={stepReason}
              onChange={(e) => setStepReason(e.target.value)}
              className={field}
            />
          </label>
        )}
        {needsAmount && (
          <label className="block text-caption">
            {t('amountEgp')}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption sm:col-span-2">
          {t('evidence')}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-body-sm"
          />
        </label>
      </div>
      <button
        type="button"
        className={`${primary} mt-3`}
        disabled={
          action.busy ||
          !employeeId ||
          description.trim().length < 3 ||
          (changed && stepReason.trim().length < 3) ||
          (needsAmount && !parseEgp(amount))
        }
        onClick={() => void submit()}
      >
        {t('recordViolation')}
      </button>
      <Feedback error={action.error} done={action.done} />
    </div>
  );
}
