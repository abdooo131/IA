'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PhotoCapture } from '@/components/orders/PhotoCapture';
import { localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { StatCard } from '@/components/StatCard';
import { WalletCard } from '@/components/WalletCard';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { title } from '@/lib/store-types';
import { useRiderLocation } from './useRiderLocation';

export interface RiderMe {
  name: string;
  badgeCode: string;
  pingSeconds: number;
  darkStore: { code: string; nameEn: string; nameAr: string };
  today: { delivered: number; failed: number; codCollectedPiastres: number };
  wallet: { cashPiastres: number; bonusOwedPiastres: number };
}
export interface RiderDelivery {
  id: string;
  status: 'assigned' | 'picked_up' | 'delivered' | 'failed';
  tripId: string | null;
  codExpectedPiastres: number;
  codCollectedPiastres: number | null;
  failedReason: string | null;
  callAttempts: number;
  /** Calls the store requires before "not answering" (delivery.min_calls_no_answer) */
  callsNeeded: number;
  returnedAt: string | null;
  order: {
    id: string;
    number: string;
    customerName: string;
    customerPhone: string;
    phoneFlagged: boolean;
    addressText: string;
    customerNote: string | null;
    latitude: number | null;
    longitude: number | null;
    paymentMethod: 'cod' | 'prepaid';
    slaDueAt: string | null;
    units: number;
    items: { sku: string; titleEn: string; titleAr: string; quantity: number }[];
  };
}

const REASONS = [
  'no_answer',
  'wrong_address',
  'refused',
  'reschedule_requested',
  'unreachable_area',
  'other',
] as const;
const KNOWN = [
  'wrong_otp',
  'proof_required',
  'cod_required',
  'delivery_closed',
  'network',
  'calls_required',
  'photo_required',
  'note_required',
];

const primary =
  'h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const field =
  'mt-1 block h-12 w-full rounded-md border border-line bg-surface px-3 text-body text-text';

/** The rider's phone screen: orders in hand, call and directions, deliver or fail. */
export function RiderHome({ me: initialMe, initial }: { me: RiderMe; initial: RiderDelivery[] }) {
  const t = useTranslations('rider');
  const tw = useTranslations('riderWallet');
  const locale = useLocale();
  const [me, setMe] = useState(initialMe);
  const [deliveries, setDeliveries] = useState(initial);

  async function refresh() {
    const [m, d] = await Promise.all([
      apiGetClient<RiderMe>('/rider/me'),
      apiGetClient<RiderDelivery[]>('/rider/deliveries'),
    ]);
    if (m.ok) setMe(m.data);
    if (d.ok) setDeliveries(d.data);
  }

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, []);

  const active = deliveries.filter((d) => d.status === 'assigned' || d.status === 'picked_up');
  const done = deliveries.filter((d) => d.status === 'delivered' || d.status === 'failed');
  const location = useRiderLocation(
    active.some((d) => d.status === 'picked_up'),
    me.pingSeconds,
  );
  const trips = new Map<string, number>();
  for (const d of active) if (d.tripId) trips.set(d.tripId, (trips.get(d.tripId) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-h2">{t('title')}</h1>
        <p className="text-body-sm text-text-muted">
          {me.name} · <span className="ltr-iso">{me.badgeCode}</span> ·{' '}
          {localized(me.darkStore, locale)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <StatCard
            icon="delivered"
            tone="delivered"
            label={t('deliveredToday')}
            value={String(me.today.delivered)}
          />
          <StatCard
            icon="returns"
            tone="returning"
            label={t('failedToday')}
            value={String(me.today.failed)}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <WalletCard
            icon="cash"
            label={tw('cashLabel')}
            value={tw('amount', { amount: formatEgp(me.wallet.cashPiastres) })}
            hint={me.wallet.cashPiastres > 0 ? tw('handIn') : undefined}
          />
          <WalletCard
            icon="wallet"
            label={tw('bonusLabel')}
            value={tw('amount', { amount: formatEgp(me.wallet.bonusOwedPiastres) })}
          />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-h3">{t('active')}</h2>
        {location === 'sharing' && (
          <p className="text-caption text-text-muted">{t('location.sharing')}</p>
        )}
        {(location === 'denied' || location === 'unsupported') && (
          <p role="alert" className="text-body-sm text-status-needs-action">
            {t(`location.${location}`)}
          </p>
        )}
        {active.length === 0 && <p className="text-body text-text-muted">{t('empty')}</p>}
        {active.map((d) => (
          <DeliveryCard
            key={d.id}
            delivery={d}
            tripSize={d.tripId ? (trips.get(d.tripId) ?? 1) : 1}
            onDone={refresh}
          />
        ))}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-h3">{t('done')}</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {done.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 px-3 py-2 text-body-sm"
              >
                <span>
                  <span className="ltr-iso font-bold">{d.order.number}</span> {d.order.customerName}
                </span>
                <span className={d.status === 'failed' ? 'text-danger' : 'text-text-muted'}>
                  {d.status === 'failed'
                    ? t(d.returnedAt ? 'doneFailedBack' : 'doneFailedBring')
                    : t('doneDelivered')}
                  {d.codCollectedPiastres ? (
                    <span className="ltr-iso ms-2">{formatEgp(d.codCollectedPiastres)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DeliveryCard({
  delivery: d,
  tripSize,
  onDone,
}: {
  delivery: RiderDelivery;
  tripSize: number;
  onDone(): Promise<void>;
}) {
  const t = useTranslations('rider');
  const tOrders = useTranslations('orders');
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'deliver' | 'fail'>('idle');
  const [otp, setOtp] = useState('');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [cash, setCash] = useState(formatEgp(d.codExpectedPiastres).replace(/,/g, ''));
  const [reason, setReason] = useState<(typeof REASONS)[number]>('no_answer');
  const [note, setNote] = useState('');
  const [doorPhotoId, setDoorPhotoId] = useState<string | null>(null);
  const [calls, setCalls] = useState(d.callAttempts);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cod = d.order.paymentMethod === 'cod' && d.codExpectedPiastres > 0;

  const fail = (code: string) => setError(t(`errors.${KNOWN.includes(code) ? code : 'generic'}`));

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/rider/deliveries/${d.id}/${path}`, body);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setMode('idle');
    await onDone();
  }

  /** The call itself goes through the phone; we only log it as proof for "not answering". */
  function logCall() {
    void apiSend<{ calls: number }>('POST', `/rider/deliveries/${d.id}/call`, {}).then((r) => {
      if (r.ok) setCalls(r.data.calls);
    });
  }

  function reportFailure() {
    if (reason === 'no_answer' && calls < d.callsNeeded) return fail('calls_required');
    if (reason === 'no_answer' && !doorPhotoId) return fail('photo_required');
    if (reason === 'other' && note.trim().length < 3) return fail('note_required');
    void send('fail', {
      reason,
      note: note.trim() || undefined,
      photoId: doorPhotoId ?? undefined,
    });
  }

  function deliver() {
    if (!/^\d{4}$/.test(otp) && !photoId) return fail('proof_required');
    // Typed EGP to piastres without floats, so 12.30 is exactly 1230.
    const piastres = parseEgp(cash);
    if (cod && piastres === null) return fail('cod_required');
    void send('complete', {
      otp: /^\d{4}$/.test(otp) ? otp : undefined,
      photoId: photoId ?? undefined,
      codCollectedPiastres: cod ? (piastres ?? undefined) : undefined,
    });
  }

  const maps =
    d.order.latitude !== null && d.order.longitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${d.order.latitude},${d.order.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.order.addressText)}`;

  return (
    <article className="space-y-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="ltr-iso text-h3">{d.order.number}</span>
        {tripSize > 1 && (
          <span className="rounded-pill bg-selected-bg px-2 text-caption text-link">
            {t('trip', { count: tripSize })}
          </span>
        )}
      </div>
      <div className="text-body-sm">
        <p className="font-bold">{d.order.customerName}</p>
        <p className="text-text-muted">{d.order.addressText}</p>
        {d.order.customerNote && <p>{d.order.customerNote}</p>}
        {d.order.phoneFlagged && (
          <p className="text-status-needs-action">⚠ {tOrders('phoneFlagged')}</p>
        )}
      </div>
      <p className={`text-body font-bold ${cod ? 'text-text' : 'text-text-muted'}`}>
        {cod ? t('collect', { amount: formatEgp(d.codExpectedPiastres) }) : t('prepaid')}
      </p>
      <ul className="text-caption text-text-muted">
        {d.order.items.map((i) => (
          <li key={i.sku}>
            <span className="ltr-iso">{i.quantity} ×</span> {title(i, locale)}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <a
          href={`tel:${d.order.customerPhone}`}
          onClick={logCall}
          className="flex h-12 flex-1 items-center justify-center rounded-md border border-line font-bold"
        >
          {t('call')}
        </a>
        <a
          href={maps}
          target="_blank"
          rel="noreferrer"
          className="flex h-12 flex-1 items-center justify-center rounded-md border border-line font-bold"
        >
          {t('map')}
        </a>
      </div>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      {mode === 'idle' && (
        <div className="flex gap-2">
          <button type="button" className={primary} onClick={() => setMode('deliver')}>
            {t('delivered')}
          </button>
          <button
            type="button"
            className="h-12 flex-1 rounded-md border border-line px-3 font-bold text-danger"
            onClick={() => setMode('fail')}
          >
            {t('failed')}
          </button>
        </div>
      )}

      {mode === 'deliver' && (
        <div className="space-y-3">
          <label className="block text-body-sm">
            {t('otp')}
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              placeholder="0000"
              className={`${field} text-center tracking-[0.5em]`}
            />
            <span className="text-caption text-text-muted">{t('otpHint')}</span>
          </label>
          <p className="text-caption text-text-muted">{t('orPhoto')}</p>
          <PhotoCapture
            kind="delivery"
            label={t('takePhoto')}
            onUploaded={setPhotoId}
            onError={fail}
          />
          {cod && (
            <label className="block text-body-sm">
              {t('cashCollected')}
              <input
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                className={field}
              />
            </label>
          )}
          <button type="button" className={primary} disabled={busy} onClick={deliver}>
            {t('delivered')}
          </button>
          <button
            type="button"
            className="w-full text-body-sm text-link"
            onClick={() => setMode('idle')}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {mode === 'fail' && (
        <div className="space-y-3">
          <label className="block text-body-sm">
            {t('failReason')}
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className={field}
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`reasons.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-caption text-text-muted">{t('callsMade', { count: calls })}</p>
          {reason === 'no_answer' && (
            <>
              {calls < d.callsNeeded && (
                <p className="text-caption text-status-needs-action">
                  {t('callsNeeded', { count: d.callsNeeded })}
                </p>
              )}
              <PhotoCapture
                kind="delivery"
                label={t('doorPhoto')}
                onUploaded={setDoorPhotoId}
                onError={fail}
              />
              <p className="text-caption text-text-muted">{t('doorPhotoHint')}</p>
            </>
          )}
          <label className="block text-body-sm">
            {t('failNote')}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              className={field}
            />
          </label>
          <p className="text-caption text-text-muted">{t('bringBack')}</p>
          <button
            type="button"
            disabled={busy}
            className="h-12 w-full rounded-md border border-danger font-bold text-danger"
            onClick={reportFailure}
          >
            {t('confirmFail')}
          </button>
          <button
            type="button"
            className="w-full text-body-sm text-link"
            onClick={() => setMode('idle')}
          >
            {t('cancel')}
          </button>
        </div>
      )}
    </article>
  );
}
