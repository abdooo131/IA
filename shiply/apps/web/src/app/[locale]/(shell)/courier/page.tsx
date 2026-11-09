'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { toast } from '@/shell/feedback';
import { ScanScreen } from '@/field/ScanScreen';
import { useScanQueue, type Answer } from '@/field/scanQueue';

interface Stop {
  id: string;
  tracking: string;
  customerName: string;
  phone: string;
  addressText: string;
  codAmount: number;
  notes: string | null;
  status: string;
}
interface Pickup {
  id: string;
  merchantId: string;
  status: string;
}

const REASONS = ['no_answer', 'refused', 'wrong_address', 'rescheduled', 'closed', 'other'];

/** The courier's phone: today's run (deliver or failed), pickups to scan, the cash he holds. */
export default function CourierPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const { pending, submit } = useScanQueue();
  const [tab, setTab] = useState<'run' | 'pickups' | 'cash'>('run');
  const [stops, setStops] = useState<Stop[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [pickupId, setPickupId] = useState('');
  const [held, setHeld] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, { cash?: string; proof?: string; reason?: string }>>({});
  const load = useCallback(async () => {
    const [r, p, c] = await Promise.all([api<{ stops: Stop[] }>('/parcels/me/run'), api<Pickup[]>('/parcels/me/pickups'), api<{ held: number }>('/parcels/me/cash')]);
    setStops(r.stops);
    setPickups(p);
    setHeld(c.held);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const show = (a: Answer | null) => {
    if (!a) return;
    if (!a.ok) toast.error(a.reason ? t(`field.answers.${a.reason}` as never) : a.big);
    void load();
  };
  const v = (id: string) => form[id] ?? {};
  const set = (id: string, patch: { cash?: string; proof?: string; reason?: string }) => setForm({ ...form, [id]: { ...v(id), ...patch } });
  const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
  return (
    <main className="field-page">
      <h1>{t('field.myDay')}</h1>
      <div className="field-steps">
        {(['run', 'pickups', 'cash'] as const).map((k) => (
          <button key={k} className={`btn${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {t(`field.${k}` as never)}
          </button>
        ))}
      </div>
      {pending > 0 && (
        <p className="scan-pending" data-testid="pending">
          {t('field.pending', { count: pending })}
        </p>
      )}
      {tab === 'run' && (stops.length === 0 ? <p>{t('field.noRun')}</p> : null)}
      {tab === 'run' &&
        stops.map((s) => (
          <div key={s.id} className="card stop" data-testid="stop">
            <strong dir="ltr">{s.tracking}</strong>
            <span>{s.customerName}</span>
            <span>{s.addressText}</span>
            <strong>{formatEgp(s.codAmount, locale)}</strong>
            <span className="pill">{t(`shiply.statuses.${s.status}` as never)}</span>
            {s.notes && <em>{s.notes}</em>}
            <div className="row-actions">
              <a className="btn" href={`tel:${s.phone}`}>
                {t('field.call')}
              </a>
              <a className="btn" href={wa(s.phone)} target="_blank" rel="noreferrer">
                {t('field.whatsapp')}
              </a>
            </div>
            {s.status === 'out_for_delivery' && (
              <>
                <div className="row-actions">
                  <label>
                    {t('field.cashCollected')}
                    <input inputMode="decimal" dir="ltr" value={v(s.id).cash ?? ''} onChange={(e) => set(s.id, { cash: e.target.value })} />
                  </label>
                  <label>
                    {t('field.proof')}
                    <select aria-label={t('field.proof')} value={v(s.id).proof ?? 'none'} onChange={(e) => set(s.id, { proof: e.target.value })}>
                      {['otp', 'photo', 'none'].map((p) => (
                        <option key={p} value={p}>
                          {t(`field.proofs.${p}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={() => void submit(`/parcels/me/parcels/${s.id}/deliver`, { cash: v(s.id).cash ?? '', proof: v(s.id).proof ?? 'none' }).then(show)}>
                    {t('field.delivered')}
                  </button>
                </div>
                <div className="row-actions">
                  <label>
                    {t('field.reason')}
                    <select aria-label={t('field.reason')} value={v(s.id).reason ?? ''} onChange={(e) => set(s.id, { reason: e.target.value })}>
                      <option value="" />
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`shiply.reasons.${r}` as never)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn" onClick={() => void submit(`/parcels/me/parcels/${s.id}/fail`, { reason: v(s.id).reason ?? '' }).then(show)}>
                    {t('field.failed')}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      {tab === 'pickups' && (
        <>
          {pickups.length === 0 && <p>{t('field.noPickups')}</p>}
          <div className="field-steps">
            {pickups.map((p) => (
              <button key={p.id} className={`btn${pickupId === p.id ? ' on' : ''}`} onClick={() => setPickupId(p.id)}>
                {p.merchantId.slice(-6)}
              </button>
            ))}
          </div>
          {pickupId && <ScanScreen body={{ step: 'pickup', pickupId }} />}
        </>
      )}
      {tab === 'cash' && held !== null && <p className="card">{t('field.holding', { amount: formatEgp(held, locale) })}</p>}
    </main>
  );
}
