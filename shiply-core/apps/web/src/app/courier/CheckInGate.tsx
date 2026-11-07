'use client';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Card, Loading } from '@/components/ui';
import { clock } from '@/components/workforce';
import { toJpeg } from '@/components/PhotoButton';
import { api, errorMessage } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLocale, useT } from '@/lib/i18n';

interface MyShift {
  date: string;
  linked: boolean;
  shift: { id: string; startAt: string; status: string; checkInAt: string | null; lateMinutes: number; replacesShiftId: string | null } | null;
}

function where(): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 },
    );
  });
}

/**
 * Couriers working for an agent check in with a photo before they see their run or pickups.
 * The check in time is what the attendance alerts use.
 */
export function CheckInGate({ children }: { children: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const my = useLoad<MyShift>('/courier/shift');
  // The wallet stays open without a check in: a frozen courier must be able to recharge.
  const open = usePathname().startsWith('/courier/wallet');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!my.data) return my.error ? <Alert>{my.error}</Alert> : <Loading />;
  const s = my.data.shift;
  if (open || !my.data.linked || s?.checkInAt) {
    return (
      <>
        {s?.checkInAt && (
          <p className="mb-3 text-caption text-text-muted">
            {t('Checked in at {time}', { time: clock(s.checkInAt, locale) })}
            {s.lateMinutes > 0 && ` · ${t('{count} min late', { count: s.lateMinutes })}`}
          </p>
        )}
        {children}
      </>
    );
  }
  if (s && (s.status === 'NOT_COMING' || s.status === 'REPLACED')) {
    return <Alert tone="warning">{t('Your agent reported you as not coming today. Call your agent')}</Alert>;
  }

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setPreview(await toJpeg(file));
    } catch {
      setError(t('Could not read the photo. Try again'));
    }
  };

  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const pos = await where();
      await api('/courier/check-in', { body: { photoBase64: preview, ...(pos ?? {}) } });
      await my.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('Check in to start your day')}>
      <div className="space-y-4">
        <p className="text-body-sm text-text-muted">
          {s ? t('Your shift starts at {time}.', { time: clock(s.startAt, locale) }) : t('No shift is planned for you today.')} {t('Take a photo of yourself at the hub to check in.')}
        </p>
        {s?.replacesShiftId && <Alert tone="info">{t('You are covering for someone today')}</Alert>}
        {error && <Alert>{error}</Alert>}
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={t('Your check in photo')} className="mx-auto max-h-72 rounded-lg" />
        ) : null}
        <div className="flex flex-col gap-2">
          <label className={preview ? 'btn-secondary cursor-pointer' : 'btn-primary min-h-12 cursor-pointer text-body'}>
            {preview ? t('Take another photo') : t('Take photo')}
            <input type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {preview && <Button className="min-h-12 text-body" disabled={busy} onClick={() => void send()}>{busy ? t('Checking in…') : t('Check in')}</Button>}
        </div>
      </div>
    </Card>
  );
}
