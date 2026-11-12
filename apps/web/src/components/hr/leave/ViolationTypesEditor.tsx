'use client';

import { PENALTY_KINDS, VIOLATION_CATEGORIES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ViolationType } from '@/lib/leave-types';
import { parseEgp } from '@/lib/money';
import { Feedback, field, primary, secondary, useAction, useName } from './kit';
import { PenaltyText } from './ViolationsTable';

type StepForm = { penalty: (typeof PENALTY_KINDS)[number]; days: string; amount: string };
type Form = {
  code: string;
  nameEn: string;
  nameAr: string;
  category: (typeof VIOLATION_CATEGORIES)[number];
  isActive: boolean;
  steps: StepForm[];
};
const withDays = (p: string) => p === 'deduction_days' || p === 'suspension_days';

/** Violation types with their escalation ladders; HR manage edits them. */
export function ViolationTypesEditor({
  rows,
  canManage,
  periodDays,
}: {
  rows: ViolationType[];
  canManage: boolean;
  periodDays: number;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const start = (x: ViolationType | null) => {
    setEditing(x?.id ?? 'new');
    setForm(
      x
        ? {
            code: x.code,
            nameEn: x.nameEn,
            nameAr: x.nameAr,
            category: x.category,
            isActive: x.isActive,
            steps: x.steps.map((s) => ({
              penalty: s.penalty,
              days: s.days === null ? '' : String(s.days),
              amount: s.amountPiastres === null ? '' : String(s.amountPiastres / 100),
            })),
          }
        : {
            code: '',
            nameEn: '',
            nameAr: '',
            category: 'conduct',
            isActive: true,
            steps: [{ penalty: 'written_warning', days: '', amount: '' }],
          },
    );
  };
  const setStep = (i: number, patch: Partial<StepForm>) =>
    form &&
    setForm({ ...form, steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  async function submit() {
    if (!form) return;
    const body = {
      code: form.code,
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      category: form.category,
      isActive: form.isActive,
      steps: form.steps.map((s) => ({
        penalty: s.penalty,
        days: withDays(s.penalty) ? Number(s.days) : null,
        amountPiastres:
          s.penalty === 'deduction_amount' && s.amount.trim() ? parseEgp(s.amount) : null,
      })),
    };
    const ok =
      editing === 'new'
        ? await action.send('POST', '/hr/violations/types', body, t('saved'))
        : await action.send('PUT', `/hr/violations/types/${editing}`, body, t('saved'));
    if (ok) setEditing(null);
  }
  const editor = form && (
    <div className="mt-3 rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-caption">
          {t('code')}
          <input
            value={form.code}
            dir="ltr"
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('nameEn')}
          <input
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('nameAr')}
          <input
            value={form.nameAr}
            dir="rtl"
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('category')}
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Form['category'] })}
            className={field}
          >
            {VIOLATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="mt-3 text-body font-bold">{t('ladder')}</h3>
      <ol className="mt-2 grid gap-2">
        {form.steps.map((s, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[auto_1fr_8rem_8rem_auto] sm:items-end">
            <span className="ltr-iso pb-2 text-caption font-bold">
              {t('stepOf', { step: i + 1 })}
            </span>
            <label className="block text-caption">
              {t('penalty')}
              <select
                value={s.penalty}
                onChange={(e) => setStep(i, { penalty: e.target.value as StepForm['penalty'] })}
                className={field}
              >
                {PENALTY_KINDS.map((p) => (
                  <option key={p} value={p}>
                    {t(`penaltyKinds.${p}`)}
                  </option>
                ))}
              </select>
            </label>
            {withDays(s.penalty) ? (
              <label className="block text-caption">
                {t('days')}
                <input
                  value={s.days}
                  dir="ltr"
                  inputMode="decimal"
                  onChange={(e) => setStep(i, { days: e.target.value })}
                  className={field}
                />
              </label>
            ) : (
              <span />
            )}
            {s.penalty === 'deduction_amount' ? (
              <label className="block text-caption">
                {t('amountEgpOptional')}
                <input
                  value={s.amount}
                  dir="ltr"
                  inputMode="decimal"
                  onChange={(e) => setStep(i, { amount: e.target.value })}
                  className={field}
                />
              </label>
            ) : (
              <span />
            )}
            <button
              type="button"
              className={secondary}
              disabled={form.steps.length === 1}
              onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}
            >
              {t('remove')}
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={secondary}
          disabled={form.steps.length >= 10}
          onClick={() =>
            setForm({
              ...form,
              steps: [...form.steps, { penalty: 'deduction_days', days: '1', amount: '' }],
            })
          }
        >
          {t('addStep')}
        </button>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          {t('active')}
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={action.busy}
          onClick={() => void submit()}
        >
          {t('save')}
        </button>
        <button type="button" className={secondary} onClick={() => setEditing(null)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
  return (
    <>
      <p className="mt-2 text-body-sm">{t('periodHint', { days: periodDays })}</p>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addViolationType')}
        </button>
      )}
      {editing === 'new' && editor}
      <Feedback error={action.error} done={action.done} />
      <ul className="mt-4 grid gap-3 lg:grid-cols-2">
        {rows.map((x) => (
          <li key={x.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {name(x)}
                  {!x.isActive && (
                    <span className="ms-2 text-caption text-text-muted">{t('inactive')}</span>
                  )}
                </p>
                <p className="text-caption text-text-muted">{t(`categories.${x.category}`)}</p>
              </div>
              {canManage && editing !== x.id && (
                <button type="button" className={secondary} onClick={() => start(x)}>
                  {t('edit')}
                </button>
              )}
            </div>
            {editing === x.id ? (
              editor
            ) : (
              <ol className="mt-2 grid gap-1 text-body-sm">
                {x.steps.map((s) => (
                  <li key={s.step} className="flex gap-2">
                    <span className="ltr-iso w-16 shrink-0 text-text-muted">
                      {t('stepOf', { step: s.step })}
                    </span>
                    <PenaltyText p={s} />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
