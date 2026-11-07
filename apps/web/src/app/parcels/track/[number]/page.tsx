'use client';
import { STATUS_LABELS_AR, type ShipmentStatus } from '@shiplynow/shared/parcels';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/parcels/components/Icon';
import { Alert, Button, Field, Input, Loading, Textarea, cx } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { dateTime, egp, shortDate } from '@/parcels/lib/format';
import { useLocale, useT } from '@/parcels/lib/i18n';
import { TrackFrame } from '../TrackFrame';

interface Tracking {
  trackingNumber: string;
  store: string;
  status: string;
  statusLabel: string;
  promisedDate: string | null;
  codToPrepare: number;
  hasLogo: boolean;
  deliverOn: string | null;
  canAct: boolean;
  canRate: boolean;
  rating: number | null;
  courier: string | null;
  events: { at: string; text: string; place: string | null }[];
}

/** What the customer can do: confirm with a note, pick another day, cancel, or rate. Their phone's last 4 digits prove it is them. */
function CustomerActions({ data, number, onDone }: { data: Tracking; number: string; onDone: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'' | 'CONFIRM' | 'POSTPONE' | 'CANCEL' | 'RATE'>('');
  const [last4, setLast4] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [rating, setRating] = useState(5);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data.canAct && !data.canRate) return null;
  const send = async () => {
    setMsg(null);
    try {
      const r = await api<{ message: string }>(`/track/${encodeURIComponent(number)}/action`, { body: { action: mode, phoneLast4: last4, note, ...(mode === 'POSTPONE' ? { date } : {}), ...(mode === 'RATE' ? { rating } : {}) } });
      setMsg({ ok: true, text: t(r.message) });
      setMode('');
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: t(e instanceof Error ? e.message : 'Something went wrong') });
    }
  };
  return (
    <section className="rounded-xl bg-surface p-5 shadow-sm">
      {msg && <div className="mb-3"><Alert tone={msg.ok ? 'success' : 'error'}>{msg.text}</Alert></div>}
      {!mode ? (
        <div className="grid grid-cols-2 gap-2">
          {data.canAct && <Button tone="secondary" onClick={() => setMode('CONFIRM')}>{t('Add a note for the courier')}</Button>}
          {data.canAct && <Button tone="secondary" onClick={() => setMode('POSTPONE')}>{t('Deliver another day')}</Button>}
          {data.canAct && <Button tone="ghost" onClick={() => setMode('CANCEL')}>{t('I do not want it')}</Button>}
          {data.canRate && <Button onClick={() => setMode('RATE')}>{t('Rate the delivery')}</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label={t('Last 4 digits of your phone')}><Input inputMode="numeric" maxLength={4} className="ltr-iso" value={last4} onChange={(e) => setLast4(e.target.value)} /></Field>
          {mode === 'POSTPONE' && <Field label={t('Day')}><Input type="date" className="ltr-iso" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
          {mode === 'RATE' && (
            <div className="flex gap-1" role="radiogroup" aria-label={t('Rating')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className={cx('h-11 w-11 rounded-md border text-h3', n <= rating ? 'border-accent bg-accent text-on-accent' : 'border-line')}>★</button>
              ))}
            </div>
          )}
          <Field label={mode === 'CONFIRM' ? t('Note for the courier') : t('Notes')}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Button tone="ghost" onClick={() => setMode('')}>{t('Back')}</Button>
            <Button disabled={last4.length !== 4 || (mode === 'POSTPONE' && !date)} onClick={() => void send()}>{t('Send')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

const ICON: Record<string, IconName> = {
  DELIVERED: 'delivered',
  RETURNED: 'returns',
  OUT_FOR_DELIVERY: 'courier',
  CANCELLED: 'alert',
};

export default function TrackingResult() {
  const t = useT();
  const locale = useLocale();
  const { number } = useParams<{ number: string }>();
  const [data, setData] = useState<Tracking | null>(null);
  const [missing, setMissing] = useState(false);

  const load = () =>
    api<Tracking>(`/track/${encodeURIComponent(number)}`)
      .then(setData)
      .catch(() => setMissing(true));
  useEffect(() => {
    void load();
  }, [number]);

  const returning = data?.statusLabel === 'Returning to the store';
  const label = !data ? '' : locale !== 'ar' ? data.statusLabel : returning ? t('Returning to the store') : STATUS_LABELS_AR[data.status as ShipmentStatus] ?? data.statusLabel;

  return (
    <TrackFrame>
      {missing ? (
        <div className="rounded-xl bg-surface p-6 text-center shadow-sm">
          <Icon name="search" size={32} className="mx-auto text-text-muted" />
          <h1 className="mt-3 text-h3">{t('We could not find this parcel')}</h1>
          <p className="mt-2 text-body-sm text-text-muted">
            {t('Check the number on your message from the store and try again:')}{' '}
            <span className="ltr-iso font-mono font-bold text-text">{decodeURIComponent(number)}</span>
          </p>
          <Link href="/parcels/track" className="btn-primary mt-5">{t('Try another number')}</Link>
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <section className="shiply-route overflow-hidden rounded-xl p-6 text-white shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {data.hasLogo && (
                  <img src={`/api/parcels/track/${encodeURIComponent(data.trackingNumber)}/logo`} alt={data.store} className="h-10 w-10 rounded-md bg-white object-contain p-1" />
                )}
                <p className="text-body-sm opacity-90">{t('Your order from {store}', { store: data.store })}</p>
              </div>
              <Icon name={ICON[data.status] ?? (returning ? 'returns' : 'tracking')} size={28} className="text-accent" />
            </div>
            <h1 className="mt-3 text-h1">{label}</h1>
            {data.courier && <p className="mt-2 text-body-sm">{t('{name} is bringing it today', { name: data.courier })}</p>}
            {data.deliverOn && <p className="mt-2 text-body-sm">{t('You asked for delivery on {date}', { date: shortDate(data.deliverOn) })}</p>}
            <p className="ltr-iso mt-3 inline-block rounded-pill bg-white/10 px-3 py-1 font-mono text-caption">{data.trackingNumber}</p>
          </section>
          <CustomerActions data={data} number={number} onDone={() => void load()} />
          {(data.promisedDate || data.codToPrepare > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {data.promisedDate && (
                <div className="rounded-xl bg-surface p-4 shadow-sm">
                  <Icon name="schedule" size={22} className="text-link" />
                  <div className="mt-3 text-label uppercase text-text-muted">{t('Expected')}</div>
                  <div className="ltr-iso mt-1 text-h3">{shortDate(data.promisedDate)}</div>
                </div>
              )}
              {data.codToPrepare > 0 && (
                <div className="rounded-xl border-2 border-accent bg-surface p-4 shadow-sm">
                  <Icon name="cash" size={22} className="text-link" />
                  <div className="mt-3 text-label uppercase text-text-muted">{t('Cash to prepare')}</div>
                  <div className="tabular ltr-iso mt-1 text-h3">{egp(data.codToPrepare)}</div>
                </div>
              )}
            </div>
          )}
          <section className="rounded-xl bg-surface p-5 shadow-sm">
            <h2 className="mb-5 text-h3">{t('Journey')}</h2>
            <ol className="relative space-y-5 border-s-2 border-line ps-6">
              {[...data.events].reverse().map((e, i) => (
                <li key={`${e.at}${i}`} className="relative">
                  <span
                    aria-hidden="true"
                    className={cx('absolute -start-[31px] top-1 h-3.5 w-3.5 rounded-pill ring-4 ring-surface', i === 0 ? 'bg-primary' : 'bg-line-strong')}
                  />
                  <div className={cx('text-body-sm', i === 0 ? 'font-bold' : 'font-semibold')}>{t(e.text)}</div>
                  <div className="text-caption text-text-muted">
                    <span className="ltr-iso">{dateTime(e.at)}</span>
                    {e.place ? ` · ${e.place}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </TrackFrame>
  );
}
