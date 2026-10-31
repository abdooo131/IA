'use client';

import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCairoTime, formatEgp } from '@/lib/format';
import type { TrackingView } from '@/lib/tracking-types';

const RiderMap = dynamic(() => import('./RiderMap'), { ssr: false });

const STEPS = ['placed', 'preparing', 'onTheWay', 'delivered'] as const;

function stepOf(status: TrackingView['status']): number {
  switch (status) {
    case 'new':
      return 0;
    case 'accepted':
    case 'picking':
    case 'packed':
      return 1;
    case 'out_for_delivery':
    case 'attempt_failed':
      return 2;
    case 'delivered':
      return 3;
    default:
      return -1;
  }
}

/** The customer's view of one order. Refreshes itself; faster while the rider is on the road. */
export function TrackingClient({ token, initial }: { token: string; initial: TrackingView }) {
  const t = useTranslations('tracking');
  const locale = useLocale();
  const [view, setView] = useState(initial);

  useEffect(() => {
    if (['delivered', 'cancelled', 'failed', 'moved_to_standard'].includes(view.status)) return;
    const timer = setInterval(async () => {
      const fresh = await apiGetClient<TrackingView>(`/track/${token}`);
      if (fresh.ok) setView(fresh.data);
    }, view.refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [token, view.status, view.refreshSeconds]);

  const step = stepOf(view.status);
  const ended = step === -1;
  const storeName = locale === 'ar' ? view.storeNameAr : view.storeNameEn;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-body-sm text-text-muted">{view.merchantName}</p>
        <h1 className="text-h2">{t('title', { number: view.number })}</h1>
        <p className="text-body font-bold" role="status">
          {t(`status.${view.status}`)}
        </p>
        {view.promiseAt && step >= 0 && step < 3 && (
          <p className="text-body-sm">
            {t('promise', { time: formatCairoTime(view.promiseAt, locale) })}
          </p>
        )}
      </header>

      {!ended && (
        <ol className="grid grid-cols-4 gap-2" aria-label={t('progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className="space-y-1 text-center">
              <span
                className={`block h-2 rounded-full ${i <= step ? 'bg-primary' : 'bg-line'}`}
                aria-hidden
              />
              <span className={`block text-caption ${i <= step ? 'font-bold' : 'text-text-muted'}`}>
                {t(`steps.${s}`)}
                {i === step && <span className="sr-only"> ({t('current')})</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {view.deliveryCode && (
        <section className="rounded-lg border border-primary bg-surface p-4 text-center">
          <p className="text-body-sm">{t('codeLabel')}</p>
          <p className="ltr-iso mt-1 text-[2.5rem] font-bold tracking-[0.3em]">
            {view.deliveryCode}
          </p>
          <p className="text-caption text-text-muted">{t('codeHint')}</p>
        </section>
      )}

      {view.paymentMethod === 'cod' && view.codAmountPiastres > 0 && step >= 0 && step < 3 && (
        <p className="rounded-lg border border-line bg-surface p-4 text-body">
          {t('cod')}{' '}
          <span className="ltr-iso font-bold">EGP {formatEgp(view.codAmountPiastres)}</span>
        </p>
      )}

      {view.status === 'out_for_delivery' && (
        <section className="space-y-2">
          {view.riderName && <p className="text-body">{t('rider', { name: view.riderName })}</p>}
          {view.riderPosition ? (
            <>
              <RiderMap rider={view.riderPosition} destination={view.destination} />
              <p className="text-caption text-text-muted">
                {t('positionAt', { time: formatCairoTime(view.riderPosition.at, locale) })}
              </p>
            </>
          ) : (
            <p className="text-body-sm text-text-muted">{t('noPosition')}</p>
          )}
        </section>
      )}

      {view.status === 'attempt_failed' && (
        <p className="rounded-lg border border-status-needs-action bg-surface p-4 text-body">
          {t('attemptFailed', { store: storeName })}
        </p>
      )}

      {view.hasProofPhoto && (
        <section className="space-y-2">
          <h2 className="text-h3">{t('proof')}</h2>
          <img
            src={`/api/track/${token}/photo`}
            alt={t('proofAlt')}
            className="max-h-80 w-full rounded-lg border border-line object-cover"
          />
        </section>
      )}

      {(view.canRate || view.rating) && (
        <RatingBox
          token={token}
          rating={view.rating}
          onRated={(r) => setView({ ...view, rating: r, canRate: false })}
        />
      )}

      <p className="text-caption text-text-muted">{t('from', { store: storeName })}</p>
    </div>
  );
}

function RatingBox({
  token,
  rating,
  onRated,
}: {
  token: string;
  rating: TrackingView['rating'];
  onRated(rating: NonNullable<TrackingView['rating']>): void;
}) {
  const t = useTranslations('tracking');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (rating)
    return (
      <section className="rounded-lg border border-line bg-surface p-4">
        <p className="text-body font-bold">{t('thanks')}</p>
        <p className="text-h3 text-primary" aria-label={t('starsLabel', { count: rating.stars })}>
          {'★'.repeat(rating.stars)}
          <span className="text-line">{'★'.repeat(5 - rating.stars)}</span>
        </p>
      </section>
    );

  async function send() {
    setBusy(true);
    setError(false);
    const result = await apiSend('POST', `/track/${token}/rating`, {
      stars,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    setBusy(false);
    if (result.ok || result.error === 'already_rated')
      onRated({ stars, comment: comment.trim() || null });
    else setError(true);
  }

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('rateTitle')}</h2>
      <div className="flex gap-1" role="radiogroup" aria-label={t('rateTitle')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={t('starsLabel', { count: n })}
            className={`h-12 w-12 rounded-md text-[2rem] leading-none ${n <= stars ? 'text-primary' : 'text-line'}`}
            onClick={() => setStars(n)}
          >
            ★
          </button>
        ))}
      </div>
      <label className="block text-body-sm">
        {t('comment')}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          className="mt-1 block w-full rounded-md border border-line bg-surface p-3"
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {t('rateError')}
        </p>
      )}
      <button
        type="button"
        disabled={busy || stars === 0}
        onClick={() => void send()}
        className="h-12 w-full rounded-md bg-primary font-bold text-on-primary disabled:opacity-50"
      >
        {t('send')}
      </button>
    </section>
  );
}
