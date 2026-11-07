'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loading, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, egp, shortDate } from '@/lib/format';

interface Tracking {
  trackingNumber: string;
  store: string;
  status: string;
  statusLabel: string;
  promisedDate: string | null;
  codToPrepare: number;
  events: { at: string; text: string; place: string | null }[];
}

const TONE: Record<string, string> = {
  DELIVERED: 'bg-emerald-600',
  RETURNED: 'bg-rose-600',
  CANCELLED: 'bg-slate-500',
  OUT_FOR_DELIVERY: 'bg-blue-600',
};

export default function TrackingResult() {
  const { number } = useParams<{ number: string }>();
  const [data, setData] = useState<Tracking | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<Tracking>(`/track/${encodeURIComponent(number)}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [number]);

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-6">
      <Link href="/track" className="mb-5 flex items-center gap-2 text-sm font-semibold text-brand-700">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">S</span>
        Shiply tracking
      </Link>
      {missing ? (
        <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-bold">We could not find this parcel</h1>
          <p className="mt-2 text-sm text-slate-600">
            Check the number <span className="font-mono font-semibold">{decodeURIComponent(number)}</span> on your message from the store and try again.
          </p>
          <Link href="/track" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Try another number</Link>
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className={cx('rounded-xl p-5 text-white shadow-sm', TONE[data.status] ?? 'bg-brand-600')}>
            <div className="text-sm opacity-90">Your order from {data.store}</div>
            <div className="mt-1 text-2xl font-bold">{data.statusLabel}</div>
            <div className="mt-1 font-mono text-sm opacity-90">{data.trackingNumber}</div>
          </div>
          {(data.promisedDate || data.codToPrepare > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {data.promisedDate && (
                <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Expected</div>
                  <div className="mt-1 text-lg font-bold">{shortDate(data.promisedDate)}</div>
                </div>
              )}
              {data.codToPrepare > 0 && (
                <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Cash to prepare</div>
                  <div className="mt-1 text-lg font-bold">{egp(data.codToPrepare)}</div>
                </div>
              )}
            </div>
          )}
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">Journey</h2>
            <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
              {[...data.events].reverse().map((e, i) => (
                <li key={`${e.at}${i}`} className="relative">
                  <span className={cx('absolute -left-[27px] top-1 h-3 w-3 rounded-full', i === 0 ? 'bg-brand-600' : 'bg-slate-300')} />
                  <div className="text-sm font-medium">{e.text}</div>
                  <div className="text-xs text-slate-500">
                    {dateTime(e.at)}
                    {e.place ? ` · ${e.place}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
