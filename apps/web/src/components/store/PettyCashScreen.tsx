'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ReceiptField } from '@/components/finance/ReceiptField';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type { StorePettyCash } from '@/lib/cash-control-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { Message } from './useStoreAction';

const KNOWN = [
  'not_enough_cash_in_box',
  'petty_category_not_found',
  'receipt_required',
  'note_required',
  'invalid_amount',
  'validation_failed',
  'network',
];
const input =
  'mt-1 block h-12 w-full rounded-md border border-line-strong bg-surface px-3 text-body';

/** Store staff pay a small expense from the store's cash box, with a photo of the receipt. */
export function PettyCashScreen({
  storeId,
  initial,
}: {
  storeId: string;
  initial: StorePettyCash;
}) {
  const t = useTranslations('cashControl.pettyStore');
  const tp = useTranslations('cashControl.petty');
  const locale = useLocale();
  const [data, setData] = useState(initial);
  const [category, setCategory] = useState(initial.categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [costTag, setCostTag] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per attempt, so a double tap or a retry records the expense once.
  const [key, setKey] = useState(newActionKey);
  const [form, setForm] = useState(0);

  async function save() {
    const piastres = parseEgp(amount);
    if (piastres === null || piastres <= 0)
      return setMessage({ text: t('errors.invalid_amount'), error: true });
    if (!photoId) return setMessage({ text: t('errors.receipt_required'), error: true });
    setBusy(true);
    const result = await apiSend<{ status: 'posted' | 'pending'; label: string }>(
      'POST',
      `/stores/${storeId}/petty-cash`,
      {
        expenseAccountId: category,
        amountPiastres: piastres,
        note: note.trim(),
        photoId,
        costTagId: costTag || undefined,
        idempotencyKey: key,
      },
    );
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`),
        error: true,
      });
    setMessage({
      text: t(result.data.status === 'posted' ? 'posted' : 'pending', {
        number: result.data.label,
      }),
      error: false,
    });
    setAmount('');
    setNote('');
    setCostTag('');
    setPhotoId(null);
    setKey(newActionKey());
    setForm((n) => n + 1);
    const fresh = await apiGetClient<StorePettyCash>(`/stores/${storeId}/petty-cash`);
    if (fresh.ok) setData(fresh.data);
  }

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-h2">{t('title')}</h1>
      <p className="text-body-sm text-text-muted">{t('intro')}</p>
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-caption text-text-muted">{t('box')}</p>
        <p className="ltr-iso text-h2">{formatEgp(data.boxPiastres)}</p>
        <p className="mt-1 text-caption text-text-muted">
          {t('limitHint', {
            limit: formatEgp(data.limitPiastres),
            float: formatEgp(data.floatPiastres),
          })}
        </p>
      </div>
      <Message message={message} />
      {data.categories.length === 0 ? (
        <p className="text-body text-text-muted">{t('noCategories')}</p>
      ) : (
        <form
          key={form}
          className="space-y-3 rounded-lg border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block text-body-sm font-semibold">
            {t('category')}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={input}
            >
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {localized(c, locale)}
                </option>
              ))}
            </select>
          </label>
          {(data.costTags ?? []).length > 0 && (
            <label className="block text-body-sm font-semibold">
              {t('costTag')}
              <select
                value={costTag}
                onChange={(e) => setCostTag(e.target.value)}
                className={input}
              >
                <option value="">{t('noCostTag')}</option>
                {(data.costTags ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {localized(c, locale)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-body-sm font-semibold">
            {t('amount')}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${input} ltr-iso`}
              placeholder="0.00"
            />
          </label>
          <label className="block text-body-sm font-semibold">
            {t('note')}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={input}
              placeholder={t('notePlaceholder')}
            />
          </label>
          <div>
            <p className="mb-1 text-body-sm font-semibold">{t('receipt')}</p>
            <ReceiptField onChange={setPhotoId} />
          </div>
          <button
            type="submit"
            disabled={busy || !photoId || note.trim().length < 3 || !amount}
            className="h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted"
          >
            {t('save')}
          </button>
        </form>
      )}
      <section>
        <h2 className="text-h3">{t('recent')}</h2>
        {data.recent.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {data.recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 px-3 py-2 text-body-sm">
                <span className="min-w-0">
                  <span className="ltr-iso me-2 font-bold">{r.label}</span>
                  {tp(`statuses.${r.status}`)}
                  <span className="block truncate text-text-muted">
                    {r.note} ·{' '}
                    <span className="ltr-iso">{formatCairoDateTime(r.createdAt, locale)}</span>
                  </span>
                </span>
                <span className="ltr-iso shrink-0 font-bold">{formatEgp(r.amountPiastres)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
