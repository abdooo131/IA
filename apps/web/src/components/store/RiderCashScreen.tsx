'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type { CashHandoverRow } from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Message } from './useStoreAction';

export interface CashScreenData {
  riders: { id: string; name: string; badgeCode: string; cashPiastres: number; outNow: number }[];
  recent: CashHandoverRow[];
}

const KNOWN = ['rider_other_store', 'invalid_amount', 'validation_failed', 'network'];

/** Staff count each rider's cash at the end of a shift; differences go to finance. */
export function RiderCashScreen({
  storeId,
  initial,
}: {
  storeId: string;
  initial: CashScreenData;
}) {
  const t = useTranslations('storeCash');
  const tf = useTranslations('finance.cash');
  const locale = useLocale();
  const [data, setData] = useState(initial);
  const [riderId, setRiderId] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt, so a double tap or a retry records the handover once.
  const [key, setKey] = useState(newActionKey);

  async function record() {
    const piastres = parseEgp(counted);
    if (piastres === null || !riderId)
      return setMessage({ text: t('errors.invalid_amount'), error: true });
    setBusy(true);
    const result = await apiSend<{ status: string; differencePiastres: number }>(
      'POST',
      `/stores/${storeId}/cash/handovers`,
      { riderId, countedPiastres: piastres, note: note.trim() || undefined, idempotencyKey: key },
    );
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
    const d = result.data.differencePiastres;
    setMessage({
      text:
        d === 0
          ? t('balanced')
          : d > 0
            ? t('short', { amount: formatEgp(d) })
            : t('over', { amount: formatEgp(0 - d) }),
      error: d !== 0,
    });
    setRiderId(null);
    setCounted('');
    setNote('');
    setKey(newActionKey());
    const fresh = await apiGetClient<CashScreenData>(`/stores/${storeId}/cash`);
    if (fresh.ok) setData(fresh.data);
  }

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-h2">{t('title')}</h1>
      <p className="text-body-sm text-text-muted">{t('intro')}</p>
      <Message message={message} />
      {data.riders.length === 0 && <p className="text-body text-text-muted">{t('none')}</p>}
      <ul className="space-y-3">
        {data.riders.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-start"
              onClick={() => {
                setRiderId(riderId === r.id ? null : r.id);
                setMessage(null);
              }}
            >
              <span>
                <span className="font-bold">{r.name}</span>{' '}
                <span className="ltr-iso whitespace-nowrap text-caption text-text-muted">
                  {r.badgeCode}
                </span>
                {r.outNow > 0 && (
                  <span className="block text-caption text-status-needs-action">
                    {t('outNow', { count: r.outNow })}
                  </span>
                )}
              </span>
              <span className="text-h3">
                {t('carrying', { amount: '' })}
                <span className="ltr-iso">{formatEgp(r.cashPiastres)}</span>
              </span>
            </button>
            {riderId === r.id && (
              <div className="mt-3 space-y-2">
                <label className="block text-body-sm">
                  {t('counted')}
                  <input
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    autoFocus
                    className="mt-1 block h-12 w-full rounded-md border border-line bg-surface px-3 text-body"
                  />
                </label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={tf('reviewNote')}
                  aria-label={tf('reviewNote')}
                  maxLength={300}
                  className="block h-12 w-full rounded-md border border-line bg-surface px-3 text-body"
                />
                <button
                  type="button"
                  disabled={busy || counted.trim() === ''}
                  onClick={() => void record()}
                  className="h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
                >
                  {t('record')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {data.recent.length > 0 && (
        <section>
          <h2 className="text-h3">{t('recent')}</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {data.recent.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-body-sm"
              >
                <span>
                  {h.rider.name}
                  <span className="ltr-iso block text-caption text-text-muted">
                    {formatCairoDateTime(h.at, locale)}
                  </span>
                </span>
                <span className="text-end">
                  <span className="ltr-iso font-bold">{formatEgp(h.countedPiastres)}</span>
                  <span className="block text-caption text-text-muted">
                    {tf(`statuses.${h.status}`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
