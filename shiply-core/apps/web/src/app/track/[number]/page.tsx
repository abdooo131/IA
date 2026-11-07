'use client';
import { STATUS_LABELS_AR, type ShipmentStatus } from '@shiply/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { Loading, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n';
import { TrackFrame } from '../TrackFrame';

interface Tracking {
  trackingNumber: string;
  store: string;
  status: string;
  statusLabel: string;
  promisedDate: string | null;
  codToPrepare: number;
  events: { at: string; text: string; place: string | null }[];
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

  useEffect(() => {
    api<Tracking>(`/track/${encodeURIComponent(number)}`)
      .then(setData)
      .catch(() => setMissing(true));
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
          <Link href="/track" className="btn-primary mt-5">{t('Try another number')}</Link>
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <section className="shiply-route overflow-hidden rounded-xl p-6 text-white shadow-md">
            <div className="flex items-start justify-between gap-3">
              <p className="text-body-sm opacity-90">{t('Your order from {store}', { store: data.store })}</p>
              <Icon name={ICON[data.status] ?? (returning ? 'returns' : 'tracking')} size={28} className="text-accent" />
            </div>
            <h1 className="mt-3 text-h1">{label}</h1>
            <p className="ltr-iso mt-3 inline-block rounded-pill bg-white/10 px-3 py-1 font-mono text-caption">{data.trackingNumber}</p>
          </section>
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
