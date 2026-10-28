'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import type { CashHandoverRow, FinanceOverview } from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { BankSelect } from './BankSelect';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

function Review({ handover }: { handover: CashHandoverRow }) {
  const t = useTranslations('finance.cash');
  const locale = useLocale();
  const action = useFinanceAction();
  const [note, setNote] = useState('');
  const d = handover.differencePiastres;
  const decide = (decision: 'write_off' | 'charge_rider') =>
    void action.send('POST', `/finance/handovers/${handover.id}/review`, { decision, note });
  return (
    <li className="space-y-2 rounded-lg border border-status-needs-action bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">
            {handover.rider.name} (<span className="ltr-iso">{handover.rider.badgeCode}</span>) ·{' '}
            {localized(handover.darkStore, locale)}
          </p>
          <p className="text-caption text-text-muted">
            <span className="ltr-iso">{formatCairoDateTime(handover.at, locale)}</span> ·{' '}
            {t('receivedBy', { name: handover.receivedBy })}
          </p>
        </div>
        <p className="text-body font-bold text-status-needs-action">
          {d > 0 ? t('short', { amount: formatEgp(d) }) : t('over', { amount: formatEgp(0 - d) })}
        </p>
      </div>
      <p className="text-body-sm">
        {t('expected')} <Amount piastres={handover.expectedPiastres} /> · {t('counted')}{' '}
        <Amount piastres={handover.countedPiastres} />
        {handover.note && <> · {handover.note}</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('reviewNote')}
          aria-label={t('reviewNote')}
          className={`${field} min-w-0 flex-1`}
        />
        <button
          type="button"
          className={button}
          disabled={action.busy || note.trim().length < 3}
          onClick={() => decide('write_off')}
        >
          {t('writeOff')}
        </button>
        <button
          type="button"
          className={button}
          disabled={action.busy || note.trim().length < 3}
          onClick={() => decide('charge_rider')}
        >
          {t('chargeRider')}
        </button>
      </div>
      <ActionMessage message={action.message} />
    </li>
  );
}

function Deposit({ store }: { store: FinanceOverview['stores'][number] }) {
  const t = useTranslations('finance.cash');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const piastres = parseEgp(amount);
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex justify-between">
        <span className="font-bold">{localized(store, locale)}</span>
        <span className="text-body-sm">
          {t('inBox', { amount: formatEgp(store.cashPiastres) })}
        </span>
      </div>
      {store.cashPiastres > 0 && (
        <div className="flex flex-wrap gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder={tf('amount')}
            aria-label={tf('amount')}
            className={`${field} w-32`}
          />
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            dir="ltr"
            placeholder={tf('reference')}
            aria-label={tf('reference')}
            className={`${field} min-w-0 flex-1`}
          />
          <BankSelect value={bank} onChange={setBank} className={field} />
          <button
            type="button"
            className={button}
            disabled={action.busy || !piastres || reference.trim().length < 2}
            onClick={async () => {
              const ok = await action.send(
                'POST',
                '/finance/deposits',
                {
                  darkStoreId: store.id,
                  amountPiastres: piastres,
                  reference,
                  bankAccountId: bank || undefined,
                  idempotencyKey: newActionKey(),
                },
                () => t('depositDone'),
              );
              if (ok) {
                setAmount('');
                setReference('');
              }
            }}
          >
            {t('deposit')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

export function CashDesk({
  pending,
  recent,
  stores,
}: {
  pending: CashHandoverRow[];
  recent: CashHandoverRow[];
  stores: FinanceOverview['stores'];
}) {
  const t = useTranslations('finance.cash');
  const locale = useLocale();
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  return (
    <div className="mt-4 space-y-8">
      <section>
        <h2 className="text-h3">{t('pending')}</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((h) => (
              <Review key={h.id} handover={h} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-h3">{t('stores')}</h2>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {stores.map((s) => (
            <Deposit key={s.id} store={s} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-h3">{t('recent')}</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className={th}>{t('rider')}</th>
                <th className={th}>{t('store')}</th>
                <th className={`${th} text-end`}>{t('expected')}</th>
                <th className={`${th} text-end`}>{t('counted')}</th>
                <th className={`${th} text-end`}>{t('difference')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {recent.map((h) => (
                <tr key={h.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="ltr-iso me-2 text-caption font-bold text-link">
                      {h.number}
                    </span>
                    {h.rider.name}
                    <p className="ltr-iso text-caption text-text-muted">
                      {formatCairoDateTime(h.at, locale)}
                    </p>
                  </td>
                  <td className="px-3 py-2">{localized(h.darkStore, locale)}</td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={h.expectedPiastres} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={h.countedPiastres} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={0 - h.differencePiastres} />
                  </td>
                  <td className="px-3 py-2 text-caption">
                    {t(`statuses.${h.status}`)}
                    {h.reviewNote && <p className="text-text-muted">{h.reviewNote}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
