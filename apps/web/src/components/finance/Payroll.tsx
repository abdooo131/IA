'use client';

import { addDays, cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { BookAccount, StaffPayRow } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';

function SalaryCell({ row, canEdit }: { row: StaffPayRow; canEdit: boolean }) {
  const t = useTranslations('finance.payroll');
  const action = useFinanceAction();
  const [text, setText] = useState(
    row.monthlyPiastres === null ? '' : formatEgp(row.monthlyPiastres).replace(/,/g, ''),
  );
  if (!canEdit)
    return row.monthlyPiastres === null ? (
      <span className="text-text-muted">{t('notSet')}</span>
    ) : (
      <Amount piastres={row.monthlyPiastres} />
    );
  const value = parseEgp(text);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        aria-label={t('salary')}
        className={`${field} w-28 text-end`}
      />
      <button
        type="button"
        disabled={action.busy || value === null}
        onClick={() =>
          void action.send('PUT', `/finance/salaries/${row.userId}`, { monthlyPiastres: value })
        }
        className="h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50"
      >
        {t('save')}
      </button>
      <ActionMessage message={action.message} />
    </span>
  );
}

/** Salaries, advances and the monthly salary run. */
export function Payroll({
  staff,
  money,
  isAdmin,
}: {
  staff: StaffPayRow[];
  money: BookAccount[];
  isAdmin: boolean;
}) {
  const t = useTranslations('finance.payroll');
  const locale = useLocale();
  const action = useFinanceAction();
  const advance = useFinanceAction();
  const lastMonth = addDays(`${cairoDay(new Date()).slice(0, 8)}01`, -1).slice(0, 7);
  const [month, setMonth] = useState(lastMonth);
  const [from, setFrom] = useState(money[0]?.id ?? '');
  const paid = staff.filter((s) => s.monthlyPiastres !== null);
  const [lines, setLines] = useState<
    Record<string, { deduction: string; recovery: string; include: boolean }>
  >(
    Object.fromEntries(paid.map((s) => [s.userId, { deduction: '', recovery: '', include: true }])),
  );
  const [adv, setAdv] = useState({
    userId: '',
    amount: '',
    reference: '',
    from: money[0]?.id ?? '',
  });
  const set = (id: string, patch: Partial<(typeof lines)[string]>) =>
    setLines({ ...lines, [id]: { ...lines[id]!, ...patch } });
  const chosen = paid.filter((s) => lines[s.userId]?.include);
  const body = {
    month,
    moneyAccountId: from,
    lines: chosen.map((s) => ({
      userId: s.userId,
      deductionPiastres: parseEgp(lines[s.userId]!.deduction || '0') ?? 0,
      advanceRecoveryPiastres: parseEgp(lines[s.userId]!.recovery || '0') ?? 0,
    })),
  };
  const net = body.lines.reduce((sum, l) => {
    const gross = paid.find((p) => p.userId === l.userId)!.monthlyPiastres ?? 0;
    return sum + gross - l.deductionPiastres - l.advanceRecoveryPiastres;
  }, 0);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const name = (s: StaffPayRow) =>
    `${s.name}${s.darkStore ? ` · ${locale === 'ar' ? s.darkStore.nameAr : s.darkStore.nameEn}` : ''}`;

  return (
    <div className="mt-4 space-y-8">
      <section>
        <h2 className="text-h3">{t('team')}</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('person')}</th>
                <th className={th}>{t('salary')}</th>
                <th className={`${th} text-end`}>{t('advanceOwed')}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.userId} className="border-t border-line">
                  <td className="px-3 py-2">{name(s)}</td>
                  <td className="px-3 py-2">
                    <SalaryCell row={s} canEdit={isAdmin} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={s.advanceOwedPiastres} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-xl space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('giveAdvance')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={adv.userId}
            onChange={(e) => setAdv({ ...adv, userId: e.target.value })}
            aria-label={t('person')}
            className={field}
          >
            <option value="">{t('person')}</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            value={adv.amount}
            onChange={(e) => setAdv({ ...adv, amount: e.target.value })}
            inputMode="decimal"
            dir="ltr"
            placeholder={t('amount')}
            aria-label={t('amount')}
            className={field}
          />
          <input
            value={adv.reference}
            onChange={(e) => setAdv({ ...adv, reference: e.target.value })}
            placeholder={t('reference')}
            aria-label={t('reference')}
            className={field}
          />
          <select
            value={adv.from}
            onChange={(e) => setAdv({ ...adv, from: e.target.value })}
            aria-label={t('paidFrom')}
            className={field}
          >
            {money.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} {locale === 'ar' ? m.nameAr : m.nameEn}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={primary}
          disabled={
            advance.busy || !adv.userId || !parseEgp(adv.amount) || adv.reference.trim().length < 2
          }
          onClick={async () => {
            const ok = await advance.send('POST', '/finance/advances', {
              userId: adv.userId,
              amountPiastres: parseEgp(adv.amount),
              moneyAccountId: adv.from,
              reference: adv.reference,
              idempotencyKey: newActionKey(),
            });
            if (ok) setAdv({ ...adv, amount: '', reference: '' });
          }}
        >
          {t('giveAdvance')}
        </button>
        <ActionMessage message={advance.message} />
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('run')}</h2>
        <div className="flex flex-wrap gap-3">
          <label className="text-caption">
            {t('month')}
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              dir="ltr"
              className={`${field} mt-1 block`}
            />
          </label>
          <label className="text-caption">
            {t('paidFrom')}
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${field} mt-1 block`}
            >
              {money.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} {locale === 'ar' ? m.nameAr : m.nameEn}
                </option>
              ))}
            </select>
          </label>
        </div>
        {paid.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('noSalaries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={th}>{t('person')}</th>
                  <th className={`${th} text-end`}>{t('salary')}</th>
                  <th className={th}>{t('deduction')}</th>
                  <th className={th}>{t('recovery')}</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((s) => (
                  <tr key={s.userId} className="border-t border-line">
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={lines[s.userId]?.include ?? false}
                          onChange={(e) => set(s.userId, { include: e.target.checked })}
                        />
                        {name(s)}
                      </label>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Amount piastres={s.monthlyPiastres ?? 0} />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={lines[s.userId]?.deduction ?? ''}
                        onChange={(e) => set(s.userId, { deduction: e.target.value })}
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0"
                        aria-label={t('deduction')}
                        className={`${field} w-24`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={lines[s.userId]?.recovery ?? ''}
                        onChange={(e) => set(s.userId, { recovery: e.target.value })}
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0"
                        aria-label={t('recovery')}
                        className={`${field} w-24`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-body font-bold">{t('netTotal', { amount: formatEgp(net) })}</p>
        <button
          type="button"
          className={primary}
          disabled={action.busy || chosen.length === 0 || !from}
          onClick={() => void action.send('POST', '/finance/payroll', body)}
        >
          {t('pay', { month })}
        </button>
        <ActionMessage message={action.message} />
      </section>
    </div>
  );
}
