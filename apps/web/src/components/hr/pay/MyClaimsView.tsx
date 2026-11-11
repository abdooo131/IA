'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { Amount } from '@/components/finance/Amount';
import { ReceiptField } from '@/components/finance/ReceiptField';
import { Pill } from '@/components/orders/detail/Card';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { statusTone } from '@/lib/leave';
import { parseEgp } from '@/lib/money';
import { formatDay } from '@/lib/my-pay';
import type { ExpenseClaim, MyExpenseClaims } from '@/lib/my-pay-types';
import { area, field, panel, primary, secondary } from '../leave/kit';

/** The status of a claim in words, as a pill. */
export function ClaimStatus({ status }: { status: ExpenseClaim['status'] }) {
  const t = useTranslations('myPay');
  return <Pill tone={statusTone(status)}>{t(`statuses.${status}`)}</Pill>;
}

/**
 * My expense claims: a form to claim back a work cost paid from one's own pocket (a claimable
 * category, the store or company wide, the day paid, a note and a receipt photo), then every
 * claim with where it stands; a claim nobody approved yet can be taken back.
 */
export function MyClaimsView({ data }: { data: MyExpenseClaims }) {
  const t = useTranslations('myPay');
  const locale = useLocale();
  const router = useRouter();
  const name = (x: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn;
  const [category, setCategory] = useState(data.categories[0]?.id ?? '');
  const [store, setStore] = useState('');
  const [amount, setAmount] = useState('');
  const [vat, setVat] = useState('');
  const [paidOn, setPaidOn] = useState(data.today);
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [key, setKey] = useState(newActionKey);
  const [form, setForm] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const explain = (code: string, details?: Record<string, unknown>) =>
    t.has(`errors.${code}`)
      ? t(`errors.${code}`, { days: String(details?.days ?? data.maxAgeDays) })
      : t('errors.generic');

  async function save() {
    const piastres = parseEgp(amount);
    if (piastres === null || piastres <= 0)
      return setMessage({ text: explain('invalid_amount'), error: true });
    // VAT is optional: empty is none; otherwise at least 0 and less than the amount.
    const vatPiastres = vat.trim() === '' ? 0 : parseEgp(vat);
    if (vatPiastres === null || vatPiastres < 0 || vatPiastres >= piastres)
      return setMessage({ text: explain('invalid_vat'), error: true });
    if (!photoId) return setMessage({ text: explain('receipt_required'), error: true });
    if (!paidOn) return setMessage({ text: explain('invalid_day'), error: true });
    setBusy(true);
    const result = await apiSend<ExpenseClaim>('POST', '/me/expense-claims', {
      amountPiastres: piastres,
      vatPiastres: vatPiastres > 0 ? vatPiastres : null,
      expenseAccountId: category,
      darkStoreId: store || null,
      paidOn,
      note: note.trim(),
      photoId,
      idempotencyKey: key,
    });
    setBusy(false);
    if (!result.ok) return setMessage({ text: explain(result.error, result.details), error: true });
    setMessage({ text: t('sent', { number: result.data.number }), error: false });
    setAmount('');
    setVat('');
    setNote('');
    setPhotoId(null);
    setKey(newActionKey());
    setForm((n) => n + 1);
    router.refresh();
  }

  async function cancel(id: string) {
    setBusy(true);
    const result = await apiSend('POST', `/me/expense-claims/${id}/cancel`, {});
    setBusy(false);
    if (!result.ok) return setMessage({ text: explain(result.error), error: true });
    setMessage({ text: t('cancelled'), error: false });
    router.refresh();
  }

  return (
    <div>
      <section className={panel}>
        <h2 className="text-h3">{t('newClaim')}</h2>
        {data.categories.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noCategories')}</p>
        ) : (
          <form
            key={form}
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="block text-body-sm font-semibold">
              {t('amount')}
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} ltr-iso mt-1`}
                placeholder="0.00"
              />
            </label>
            <label className="block text-body-sm font-semibold">
              {t('vat')}
              <input
                inputMode="decimal"
                value={vat}
                onChange={(e) => setVat(e.target.value)}
                className={`${field} ltr-iso mt-1`}
                placeholder="0.00"
              />
              <span className="mt-1 block text-caption font-normal text-text-muted">
                {t('vatHint')}
              </span>
            </label>
            <label className="block text-body-sm font-semibold">
              {t('category')}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`${field} mt-1`}
              >
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {name(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-body-sm font-semibold">
              {t('store')}
              <select
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className={`${field} mt-1`}
              >
                <option value="">{t('companyWide')}</option>
                {data.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {name(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-body-sm font-semibold">
              {t('paidOn')}
              <DateInput
                value={paidOn}
                max={data.today}
                onChange={(e) => setPaidOn(e.target.value)}
                className="mt-1"
              />
              <span className="mt-1 block text-caption font-normal text-text-muted">
                {t('paidOnHint', { days: data.maxAgeDays })}
              </span>
            </label>
            <label className="block text-body-sm font-semibold sm:col-span-2">
              {t('note')}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`${area} mt-1`}
                placeholder={t('notePlaceholder')}
                maxLength={500}
              />
            </label>
            <div className="sm:col-span-2">
              <p className="mb-1 text-body-sm font-semibold">{t('receipt')}</p>
              <ReceiptField onChange={setPhotoId} />
              <p className="mt-1 text-caption text-text-muted">{t('noVat')}</p>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className={primary} disabled={busy}>
                {t('send')}
              </button>
            </div>
          </form>
        )}
        {message && (
          <p
            role="status"
            className={`mt-3 text-body-sm ${message.error ? 'text-danger' : 'text-status-delivered'}`}
          >
            {message.text}
          </p>
        )}
      </section>

      <section className={panel}>
        <h2 className="text-h3">{t('myClaims')}</h2>
        {data.claims.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noClaims')}</p>
        ) : (
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {data.claims.map((c) => (
              <li key={c.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="ltr-iso font-bold">{c.number}</span>
                  <ClaimStatus status={c.status} />
                </div>
                <p className="mt-1 text-body-sm">
                  <Amount piastres={c.amountPiastres} strong /> · {name(c.category)} ·{' '}
                  {c.store ? c.store.code : t('companyWide')}
                </p>
                {c.vatPiastres > 0 && (
                  <p className="text-caption text-text-muted">
                    {t('vatLine')} <Amount piastres={c.vatPiastres} />
                  </p>
                )}
                <p className="text-caption text-text-muted">
                  {t('paidOnShort', { day: formatDay(c.paidOn) })} · {c.note}
                </p>
                {c.status === 'pending_manager' && (
                  <p className="text-caption text-text-muted">{t('waitingManager')}</p>
                )}
                {c.status === 'pending_accounting' && (
                  <p className="text-caption text-text-muted">{t('waitingAccounting')}</p>
                )}
                {c.status === 'paid' && c.paidAt && (
                  <p className="text-caption text-text-muted">
                    {t('paidLine', { at: formatCairoDateTime(c.paidAt, locale) })}
                  </p>
                )}
                {c.status === 'rejected' && c.rejectReason && (
                  <p className="text-caption text-danger">
                    {t('rejectedLine', { reason: c.rejectReason })}
                  </p>
                )}
                {c.cancellable && (
                  <button
                    type="button"
                    className={`${secondary} mt-2 h-9 px-3`}
                    disabled={busy}
                    onClick={() => void cancel(c.id)}
                  >
                    {t('cancel')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
