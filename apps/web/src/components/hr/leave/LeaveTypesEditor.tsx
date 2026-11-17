'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { LeaveType } from '@/lib/leave-types';
import { Feedback, field, primary, secondary, td, th, useAction, useName } from './kit';

type Form = {
  code: string;
  nameEn: string;
  nameAr: string;
  paid: boolean;
  balance: 'annual' | 'own' | 'none';
  yearlyDays: string;
  casualAllowance: boolean;
  documentAboveDays: string;
  maxDaysPerRequest: string;
  noticeDays: string;
  selfRequest: boolean;
  isActive: boolean;
};
const blank: Form = {
  code: '',
  nameEn: '',
  nameAr: '',
  paid: true,
  balance: 'own',
  yearlyDays: '',
  casualAllowance: false,
  documentAboveDays: '',
  maxDaysPerRequest: '',
  noticeDays: '0',
  selfRequest: true,
  isActive: true,
};
const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Leave types HR manages: paid or not, which balance, document, limits and notice. */
export function LeaveTypesEditor({ rows, canManage }: { rows: LeaveType[]; canManage: boolean }) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const start = (x: LeaveType | null) => {
    setEditing(x?.id ?? 'new');
    setForm(
      x
        ? {
            code: x.code,
            nameEn: x.nameEn,
            nameAr: x.nameAr,
            paid: x.paid,
            balance: x.balance,
            yearlyDays: x.yearlyDays === null ? '' : String(x.yearlyDays),
            casualAllowance: x.casualAllowance,
            documentAboveDays: x.documentAboveDays === null ? '' : String(x.documentAboveDays),
            maxDaysPerRequest: x.maxDaysPerRequest === null ? '' : String(x.maxDaysPerRequest),
            noticeDays: String(x.noticeDays),
            selfRequest: x.selfRequest,
            isActive: x.isActive,
          }
        : blank,
    );
  };
  async function submit() {
    const body = {
      ...form,
      yearlyDays: num(form.yearlyDays),
      documentAboveDays: num(form.documentAboveDays),
      maxDaysPerRequest: num(form.maxDaysPerRequest),
      noticeDays: Number(form.noticeDays) || 0,
    };
    const ok =
      editing === 'new'
        ? await action.send('POST', '/hr/leave/types', body, t('saved'))
        : await action.send('PUT', `/hr/leave/types/${editing}`, body, t('saved'));
    if (ok) setEditing(null);
  }
  const text = (key: keyof Form, label: string, ltr = false) => (
    <label className="block text-caption">
      {label}
      <input
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        dir={ltr ? 'ltr' : undefined}
        className={field}
      />
    </label>
  );
  const check = (key: keyof Form, label: string) => (
    <label className="flex items-center gap-2 text-body-sm">
      <input
        type="checkbox"
        checked={Boolean(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const editor = (
    <div className="mt-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
      {text('code', t('code'), true)}
      {text('nameEn', t('nameEn'))}
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
        {t('balance')}
        <select
          value={form.balance}
          onChange={(e) => setForm({ ...form, balance: e.target.value as Form['balance'] })}
          className={field}
        >
          {(['annual', 'own', 'none'] as const).map((b) => (
            <option key={b} value={b}>
              {t(`balances.${b}`)}
            </option>
          ))}
        </select>
      </label>
      {text('yearlyDays', t('yearlyDays'), true)}
      {text('documentAboveDays', t('documentAboveDays'), true)}
      {text('maxDaysPerRequest', t('maxDaysPerRequest'), true)}
      {text('noticeDays', t('noticeDays'), true)}
      <div className="grid gap-1 sm:col-span-2 lg:col-span-4">
        {check('paid', t('paid'))}
        {check('casualAllowance', t('casualAllowance'))}
        {check('selfRequest', t('selfRequest'))}
        {check('isActive', t('active'))}
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
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
  const rule = (x: LeaveType) =>
    [
      x.paid ? t('paid') : t('unpaid'),
      x.balance === 'annual'
        ? x.casualAllowance
          ? t('fromAnnualCasual')
          : t('fromAnnual')
        : x.balance === 'own'
          ? t('ownAllowance', {
              days: x.casualAllowance ? t('casualSetting') : (x.yearlyDays ?? 0),
            })
          : t('noBalance'),
      x.documentAboveDays !== null
        ? x.documentAboveDays === 0
          ? t('documentAlways')
          : t('documentAbove', { days: x.documentAboveDays })
        : null,
      x.maxDaysPerRequest ? t('maxHint', { days: x.maxDaysPerRequest }) : null,
      x.noticeDays ? t('noticeHint', { days: x.noticeDays }) : null,
      x.selfRequest ? null : t('hrOnly'),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-4`} onClick={() => start(null)}>
          {t('addType')}
        </button>
      )}
      {editing === 'new' && editor}
      <Feedback error={action.error} done={action.done} />
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('type')}</th>
              <th className={th}>{t('rules')}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((x) => (
              <tr key={x.id}>
                <td className={td} colSpan={editing === x.id ? 3 : 1}>
                  <span className="font-bold">{name(x)}</span>
                  <span className="ltr-iso ms-2 text-caption text-text-muted">{x.code}</span>
                  {!x.isActive && (
                    <span className="ms-2 text-caption text-text-muted">{t('inactive')}</span>
                  )}
                  {editing === x.id && editor}
                </td>
                {editing !== x.id && (
                  <>
                    <td className={`${td} text-caption`}>{rule(x)}</td>
                    <td className={`${td} text-end`}>
                      {canManage && (
                        <button type="button" className={secondary} onClick={() => start(x)}>
                          {t('edit')}
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
