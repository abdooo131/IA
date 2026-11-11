'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import type { BasataSettlementForm as FormData } from '@/lib/basata';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';

const field = 'h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * Record Basata transfer: the bank it reached (CIB first), the day, the amount that arrived and
 * the approved deposits it covers (all ticked; untick any it did not cover). Basata's fee is
 * the deposits' total less the amount and is shown before saving; it can never be negative.
 */
export function BasataSettlementForm({ data, today }: { data: FormData; today: string }) {
  const t = useTranslations('basata.transfer');
  const tb = useTranslations('basata');
  const locale = useLocale();
  const router = useRouter();
  const [bank, setBank] = useState(data.banks[0]?.id ?? '');
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set(data.deposits.map((d) => d.id)));
  const [key, setKey] = useState(newActionKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const total = useMemo(
    () => data.deposits.filter((d) => chosen.has(d.id)).reduce((s, d) => s + d.amountPiastres, 0),
    [chosen, data.deposits],
  );
  const received = parseEgp(amount);
  const fee = received === null ? null : total - received;

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  }

  async function submit() {
    if (received === null || received <= 0)
      return setMessage({ text: tb('errors.invalid_amount'), error: true });
    if (fee !== null && fee < 0)
      return setMessage({ text: tb('errors.more_than_deposits'), error: true });
    setBusy(true);
    setMessage(null);
    const r = await apiSend('POST', '/finance/basata/settlements', {
      ...(bank && { bankAccountId: bank }),
      receivedOn: day,
      amountPiastres: received,
      depositIds: [...chosen],
      ...(reference.trim() && { reference: reference.trim() }),
      idempotencyKey: key,
    });
    setBusy(false);
    if (!r.ok)
      return setMessage({
        text: tb.has(`errors.${r.error}`) ? tb(`errors.${r.error}`) : tb('errors.generic'),
        error: true,
      });
    setMessage({ text: t('done'), error: false });
    setAmount('');
    setReference('');
    setKey(newActionKey());
    router.refresh();
  }

  return (
    <form
      className="mt-4 space-y-4 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-caption">
          {t('bank')}
          <select
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            className={`${field} mt-1 block`}
          >
            {data.banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {localized(b, locale) || b.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('day')}
          <DateInput
            value={day}
            onChange={(e) => setDay(e.target.value)}
            max={today}
            className={`${field} mt-1 block`}
          />
        </label>
        <label className="block text-caption">
          {t('amount')}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className={`${field} mt-1 block w-36`}
          />
        </label>
        <label className="block text-caption">
          {t('reference')}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            dir="ltr"
            maxLength={100}
            className={`${field} mt-1 block`}
          />
        </label>
      </div>

      <p className="text-body-sm">
        {t('summary', {
          count: chosen.size,
          total: formatEgp(total),
          fee: fee === null ? '–' : formatEgp(fee),
        })}
      </p>
      {fee !== null && fee < 0 && (
        <p className="text-caption text-danger">{tb('errors.more_than_deposits')}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-body-sm">
          <thead>
            <tr className="border-b border-line text-start text-caption text-text-muted">
              <th className="py-2 text-start" />
              <th className="py-2 text-start">{t('deposit')}</th>
              <th className="py-2 text-start">{t('rider')}</th>
              <th className="py-2 text-start">{t('depositedAt')}</th>
              <th className="py-2 text-end">{t('depositAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.deposits.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-text-muted">
                  {t('none')}
                </td>
              </tr>
            )}
            {data.deposits.map((d) => (
              <tr key={d.id} className="border-b border-line">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(d.id)}
                    onChange={() => toggle(d.id)}
                    aria-label={d.number}
                  />
                </td>
                <td className="ltr-iso py-2">{d.number}</td>
                <td className="py-2">
                  {d.rider.name} <span className="ltr-iso text-text-muted">{d.store.code}</span>
                </td>
                <td className="ltr-iso py-2">{formatCairoDateTime(d.depositedAt, locale)}</td>
                <td className="ltr-iso py-2 text-end">{formatEgp(d.amountPiastres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="submit"
        disabled={busy || chosen.size === 0 || !bank}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
      >
        {t('save')}
      </button>
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
