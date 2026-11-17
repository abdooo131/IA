'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhotoCapture } from '@/components/orders/PhotoCapture';
import { apiSend } from '@/lib/api-client';
import type { FreezeReason, RiderBasataView } from '@/lib/basata';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { StatusPill } from '@/components/StatusPill';

const field =
  'mt-1 block h-12 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-body';
const primary =
  'h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted';

/** A frozen rider's red banner: why, and what to do (deposit, then call Accounting). */
export function FrozenBanner({ reason }: { reason: FreezeReason | null }) {
  const t = useTranslations('riderBasata');
  return (
    <div role="alert" className="rounded-lg border-2 border-danger bg-surface p-4 text-danger">
      <p className="font-bold">{t('frozen.title')}</p>
      <p className="mt-1 text-body-sm">{t(`frozen.reasons.${reason ?? 'deposit_deadline'}`)}</p>
      <p className="mt-1 text-body-sm">{t('frozen.what')}</p>
    </div>
  );
}

/** "Now" as the value of a datetime-local box (the phone's own time zone). */
function localNow() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * The rider's Basata screen (mobile first): the cash to deposit, the deadline, a deposit form
 * (receipt photo by the phone camera, amount, Basata's reference, when) and the deposits sent
 * with their status.
 */
export function RiderBasata({ view }: { view: RiderBasataView }) {
  const t = useTranslations('riderBasata');
  const locale = useLocale();
  const router = useRouter();
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [amount, setAmount] = useState(
    view.maxPiastres > 0 ? formatEgp(view.maxPiastres).replace(/,/g, '') : '',
  );
  const [reference, setReference] = useState('');
  const [when, setWhen] = useState(localNow);
  const [key, setKey] = useState(newActionKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const error = (code: string) =>
    t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
  const piastres = parseEgp(amount);

  async function submit() {
    if (!photoId) return setMessage({ text: error('receipt_required'), error: true });
    if (piastres === null || piastres <= 0)
      return setMessage({ text: error('invalid_amount'), error: true });
    if (piastres > view.maxPiastres)
      return setMessage({ text: error('more_than_cash'), error: true });
    if (reference.trim().length < 3)
      return setMessage({ text: error('reference_required'), error: true });
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) return setMessage({ text: error('invalid_time'), error: true });
    setBusy(true);
    setMessage(null);
    const r = await apiSend('POST', '/rider/basata/deposits', {
      amountPiastres: piastres,
      reference: reference.trim(),
      depositedAt: at.toISOString(),
      photoId,
      idempotencyKey: key,
    });
    setBusy(false);
    if (!r.ok) return setMessage({ text: error(r.error), error: true });
    setMessage({ text: t('sent'), error: false });
    setPhotoId(null);
    setReference('');
    setKey(newActionKey());
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {view.frozen && <FrozenBanner reason={view.frozen.reason} />}

      <section className="rounded-lg border border-line bg-surface p-4">
        <dl className="grid grid-cols-2 gap-3 text-body-sm">
          <div>
            <dt className="text-text-muted">{t('toHandIn')}</dt>
            <dd className="ltr-iso text-h3">{formatEgp(view.toHandInPiastres)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t('waiting')}</dt>
            <dd className="ltr-iso text-h3">{formatEgp(view.pendingPiastres)}</dd>
          </div>
          {view.deductedPiastres > 0 && (
            <div className="col-span-2">
              <dt className="text-text-muted">{t('deducted')}</dt>
              <dd className="ltr-iso font-bold text-danger">{formatEgp(view.deductedPiastres)}</dd>
              <dd className="text-caption text-text-muted">{t('deductedHint')}</dd>
            </div>
          )}
        </dl>
        {view.deadline && (
          <p className="mt-3 text-caption text-text-muted">
            {t('deadline', { time: formatCairoDateTime(view.deadline.at, locale) })}
          </p>
        )}
      </section>

      {!view.enabled ? (
        <p role="status" className="rounded-lg border border-line bg-surface p-4 text-body-sm">
          {t('closed')}
        </p>
      ) : (
        <form
          className="space-y-3 rounded-lg border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-h3">{t('formTitle')}</h2>
          <PhotoCapture
            kind="basata_receipt"
            label={t('photo')}
            onUploaded={(id) => setPhotoId(id)}
            onError={(code) => setMessage({ text: error(code), error: true })}
          />
          <label className="block text-body-sm font-semibold">
            {t('amount')}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              className={field}
            />
          </label>
          <p className="text-caption text-text-muted">
            {t('max', { amount: formatEgp(view.maxPiastres) })}
          </p>
          <label className="block text-body-sm font-semibold">
            {t('reference')}
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              dir="ltr"
              autoCapitalize="characters"
              maxLength={60}
              className={field}
            />
          </label>
          <label className="block text-body-sm font-semibold">
            {t('when')}
            <input
              type="datetime-local"
              value={when}
              max={localNow()}
              onChange={(e) => setWhen(e.target.value)}
              dir="ltr"
              className={field}
            />
          </label>
          <button type="submit" disabled={busy || view.maxPiastres <= 0} className={primary}>
            {busy ? t('sending') : t('send')}
          </button>
          {message && (
            <p
              role={message.error ? 'alert' : 'status'}
              className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
            >
              {message.text}
            </p>
          )}
        </form>
      )}

      <section className="space-y-2">
        <h2 className="text-h3">{t('mine')}</h2>
        {view.deposits.length === 0 && <p className="text-body text-text-muted">{t('none')}</p>}
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {view.deposits.map((d) => (
            <li key={d.id} className="px-3 py-2 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="ltr-iso font-bold">{d.number}</span>
                <StatusPill status={d.status}>{t(`statuses.${d.status}`)}</StatusPill>
              </div>
              <div className="flex items-center justify-between gap-2 text-text-muted">
                <span className="ltr-iso">{d.reference}</span>
                <span className="ltr-iso">{formatEgp(d.amountPiastres)}</span>
              </div>
              <div className="text-caption text-text-muted">
                {formatCairoDateTime(d.depositedAt, locale)}
              </div>
              {d.status === 'rejected' && d.rejectReason && (
                <p className="mt-1 text-caption text-danger">{d.rejectReason}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
