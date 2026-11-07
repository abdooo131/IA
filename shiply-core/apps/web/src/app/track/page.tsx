'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Button, Input } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { TrackFrame } from './TrackFrame';

export default function TrackPage() {
  const t = useT();
  const router = useRouter();
  const [number, setNumber] = useState('');
  return (
    <TrackFrame>
      <section className="shiply-route mb-5 overflow-hidden rounded-xl p-6 text-white shadow-md">
        <Icon name="tracking" size={32} className="text-accent" />
        <h1 className="mt-4 text-h2">{t('Track your parcel')}</h1>
        <p className="mt-2 text-body-sm opacity-90">{t('Shiply next day delivery')}</p>
      </section>
      <form
        className="rounded-xl bg-surface p-5 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const n = number.trim().toUpperCase().replace(/\s+/g, '');
          if (n) router.push(`/track/${encodeURIComponent(n)}`);
        }}
      >
        <label htmlFor="tn" className="mb-1 block text-caption font-semibold">{t('Tracking number')}</label>
        <Input id="tn" dir="ltr" autoFocus placeholder="SHP0000010005" value={number} onChange={(e) => setNumber(e.target.value)} className="font-mono uppercase" />
        <Button type="submit" className="mt-4 w-full" disabled={!number.trim()}>
          <Icon name="search" size={18} />
          {t('Track')}
        </Button>
      </form>
    </TrackFrame>
  );
}
