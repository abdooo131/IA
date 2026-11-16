'use client';

import { FAILURE_REASONS, type FailureReason } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import type { OrderDetail } from '@/lib/order-types';
import { PhotoCapture } from './PhotoCapture';

const KNOWN_ERRORS = [
  'invalid_order_state',
  'delivery_closed',
  'cod_required',
  'photo_required',
  'note_required',
  'no_access',
  'store_not_allowed',
  'validation_failed',
  'reason_short',
  'network',
];

const field =
  'mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';

/**
 * Close for the rider: a manager (operations manage, or the store manager) marks an order
 * that is out for delivery as delivered or failed when its rider cannot do it from the app.
 * The same steps run as when the rider does it; a reason is always required.
 */
export function CloseForRiderPanel({
  apiPath,
  order,
  onDone,
  onCancel,
}: {
  /** The order's API path; the panel posts to `${apiPath}/close-for-rider` */
  apiPath: string;
  order: OrderDetail;
  onDone(): void;
  onCancel(): void;
}) {
  const t = useTranslations('closeForRider');
  const tr = useTranslations('rider');
  const open = order.deliveries.find((d) => d.status === 'picked_up');
  const isCod = order.paymentMethod === 'cod' && (open?.codExpectedPiastres ?? 0) > 0;
  const [outcome, setOutcome] = useState<'delivered' | 'failed'>('delivered');
  const [reason, setReason] = useState('');
  const [cash, setCash] = useState(
    isCod && open ? (open.codExpectedPiastres / 100).toFixed(2) : '',
  );
  const [failureReason, setFailureReason] = useState<FailureReason>('no_answer');
  const [note, setNote] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (code: string) =>
    setError(t(`errors.${KNOWN_ERRORS.includes(code) ? code : 'generic'}`));

  async function submit() {
    setError(null);
    if (reason.trim().length < 5) return fail('reason_short');
    let body: Record<string, unknown>;
    if (outcome === 'delivered') {
      const collected = isCod ? parseEgp(cash) : null;
      if (isCod && collected === null) return fail('cod_required');
      body = {
        outcome,
        reason: reason.trim(),
        ...(collected !== null && { codCollectedPiastres: collected }),
        ...(photoId && { photoId }),
      };
    } else {
      if (failureReason === 'other' && note.trim().length < 3) return fail('note_required');
      body = {
        outcome,
        reason: reason.trim(),
        failureReason,
        ...(note.trim() && { note: note.trim() }),
        ...(photoId && { photoId }),
      };
    }
    setBusy(true);
    const result = await apiSend('POST', `${apiPath}/close-for-rider`, body);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    onDone();
  }

  return (
    <section
      className="max-w-md space-y-3 rounded-xl border border-line bg-surface p-4"
      aria-label={t('title')}
    >
      <h2 className="text-h3">{t('title')}</h2>
      <p className="text-body-sm text-text-muted">
        {t('intro', { rider: open ? `${open.rider} (${open.badge})` : '' })}
      </p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">{t('outcome')}</legend>
        {(['delivered', 'failed'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-body-sm font-bold">
            <input
              type="radio"
              name="close-outcome"
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            />
            {t(`outcomes.${value}`)}
          </label>
        ))}
      </fieldset>
      <label className="block text-body-sm font-bold">
        {t('reason')}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={2}
          className={`${field} py-2`}
          placeholder={t('reasonHint')}
        />
      </label>
      {outcome === 'delivered' && isCod && open && (
        <label className="block text-body-sm font-bold">
          {tr('cashCollected')}
          <input
            inputMode="decimal"
            dir="ltr"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            className={`${field} h-10`}
          />
          <span className="mt-1 block text-caption font-normal text-text-muted">
            {t('cashExpected', { amount: formatEgp(open.codExpectedPiastres) })}
          </span>
        </label>
      )}
      {outcome === 'failed' && (
        <>
          <label className="block text-body-sm font-bold">
            {tr('failReason')}
            <select
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value as FailureReason)}
              className={`${field} h-10`}
            >
              {FAILURE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(`reasons.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-body-sm font-bold">
            {tr('failNote')}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              className={`${field} h-10`}
            />
          </label>
        </>
      )}
      <div className="space-y-1">
        <PhotoCapture
          kind="delivery"
          label={photoId ? t('photoTaken') : t('photo')}
          onUploaded={setPhotoId}
          onError={fail}
        />
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void submit()} className="btn-primary">
          {outcome === 'delivered' ? t('confirmDelivered') : t('confirmFailed')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          {t('back')}
        </button>
      </div>
    </section>
  );
}
