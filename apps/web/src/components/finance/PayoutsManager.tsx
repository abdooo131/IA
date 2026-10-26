'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PayoutRow } from '@/lib/finance-types';
import { formatCairoDateTime, formatCutoffDay } from '@/lib/format';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';

function DraftCard({ payout }: { payout: PayoutRow }) {
  const t = useTranslations('finance.payouts');
  const locale = useLocale();
  const action = useFinanceAction();
  const [reference, setReference] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-h3">{payout.merchant.name}</p>
          <p className="text-caption text-text-muted">
            {t('cutoff')}{' '}
            <span className="ltr-iso">{formatCutoffDay(payout.cutoffAt, locale)}</span> ·{' '}
            {t('created', { name: payout.createdBy })}
          </p>
        </div>
        <p className="text-h3">
          <Amount piastres={payout.amountPiastres} strong /> EGP
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          dir="ltr"
          placeholder={t('transferRef')}
          aria-label={t('transferRef')}
          className={`${field} min-w-0 flex-1`}
        />
        <button
          type="button"
          className={primary}
          disabled={action.busy || reference.trim().length < 2}
          onClick={() =>
            void action.send('POST', `/finance/payouts/${payout.id}/paid`, { reference })
          }
        >
          {t('markPaid')}
        </button>
        <button type="button" className={button} onClick={() => setCancelling(!cancelling)}>
          {t('cancelPayout')}
        </button>
      </div>
      {cancelling && (
        <div className="flex flex-wrap gap-2">
          <input
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder={t('cancelNote')}
            aria-label={t('cancelNote')}
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            className={`${button} text-danger`}
            disabled={action.busy || cancelNote.trim().length < 3}
            onClick={() =>
              void action.send('POST', `/finance/payouts/${payout.id}/cancel`, { note: cancelNote })
            }
          >
            {t('cancelPayout')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

export function PayoutsManager({ payouts, today }: { payouts: PayoutRow[]; today: string }) {
  const t = useTranslations('finance.payouts');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const [cutoff, setCutoff] = useState(today);
  const drafts = payouts.filter((p) => p.status === 'draft');
  const done = payouts.filter((p) => p.status !== 'draft');
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';

  return (
    <div className="mt-4 space-y-8">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <label className="text-caption">
          {t('cutoffDay')}
          <input
            type="date"
            value={cutoff}
            max={today}
            onChange={(e) => setCutoff(e.target.value)}
            dir="ltr"
            className={`${field} mt-1 block`}
          />
        </label>
        <button
          type="button"
          className={primary}
          disabled={action.busy}
          onClick={() =>
            void action.send<{ created: unknown[] }>(
              'POST',
              '/finance/payouts/due',
              { cutoffDay: cutoff },
              (d) =>
                d.created.length ? t('prepared', { count: d.created.length }) : t('skippedNone'),
            )
          }
        >
          {t('prepareDue')}
        </button>
        <ActionMessage message={action.message} />
      </section>

      <section>
        <h2 className="text-h3">{t('draft')}</h2>
        {drafts.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{tf('empty')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {drafts.map((p) => (
              <DraftCard key={p.id} payout={p} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="text-h3">{t('paid')}</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[720px] text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th className={th}>{t('merchant')}</th>
                  <th className={th}>{t('cutoff')}</th>
                  <th className={`${th} text-end`}>EGP</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {done.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-bold">{p.merchant.name}</td>
                    <td className="ltr-iso px-3 py-2">{formatCutoffDay(p.cutoffAt, locale)}</td>
                    <td className="px-3 py-2 text-end">
                      <Amount piastres={p.amountPiastres} />
                    </td>
                    <td className="px-3 py-2 text-caption">
                      {t(`statuses.${p.status}`)}
                      {p.reference && <span className="ltr-iso"> · {p.reference}</span>}
                      {p.paidBy && p.paidAt && (
                        <p className="text-text-muted">
                          {t('paidBy', {
                            name: p.paidBy,
                            time: formatCairoDateTime(p.paidAt, locale),
                          })}
                        </p>
                      )}
                      {p.status === 'cancelled' && p.note && (
                        <p className="text-text-muted">{p.note}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
