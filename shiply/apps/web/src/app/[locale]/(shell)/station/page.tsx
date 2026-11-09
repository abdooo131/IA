'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/shell/feedback';
import { ScanScreen } from '@/field/ScanScreen';

interface Site {
  id: string;
  kind: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

const STEPS: Record<string, string[]> = {
  sorting_facility: ['inbound', 'sorting', 'outbound', 'car_load', 'hub_bag', 'hub_receive'],
  last_mile_hub: ['hub_bag', 'hub_receive', 'hub_sort', 'dispatch', 'hub_return', 'outbound', 'car_load'],
};

/** The hub station: the user's site, its steps, one scan box, the answer in big letters. */
export default function StationPage() {
  const t = useTranslations('field');
  const tc = useTranslations('common');
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [step, setStep] = useState('');
  const [seal, setSeal] = useState('');
  const [carId, setCarId] = useState('');
  const [runId, setRunId] = useState('');
  const [cars, setCars] = useState<{ id: string; toSiteId: string; driverName: string; status: string }[]>([]);
  const [runs, setRuns] = useState<{ id: string; courierId: string; status: string }[]>([]);
  const [count, setCount] = useState<{ expected: number; received: number } | null>(null);
  useEffect(() => {
    api<Site[]>('/parcels/me/sites').then(
      (s) => {
        setSites(s);
        if (s.length === 1) setSiteId(s[0]!.id);
      },
      () => toast.error(tc('failed')),
    );
  }, [tc]);
  const site = sites.find((s) => s.id === siteId);
  const refresh = useCallback(async () => {
    if (!site) return;
    if (site.kind === 'sorting_facility') setCount(await api<{ expected: number; received: number }>(`/parcels/facility/${site.id}/inbound`));
    if (step === 'car_load') setCars((await api<typeof cars>(`/parcels/cars?site=${site.id}`)).filter((c) => c.status === 'loading'));
    if (step === 'dispatch') setRuns((await api<typeof runs>(`/parcels/runs?hub=${site.id}`)).filter((r) => r.status !== 'closed'));
  }, [site, step]);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  const body = useMemo(
    () => ({ step, siteId, ...(['outbound', 'hub_receive'].includes(step) ? { bagSeal: seal } : {}), ...(step === 'car_load' ? { carId } : {}), ...(step === 'dispatch' ? { runId } : {}) }),
    [step, siteId, seal, carId, runId],
  );
  return (
    <main className="field-page">
      <h1>{t('station')}</h1>
      <label>
        {t('site')}
        <select aria-label={t('site')} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="" />
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{`${s.code} · ${s.nameEn}`}</option>
          ))}
        </select>
      </label>
      {count && <strong>{t('countLine', count)}</strong>}
      {site && (
        <div className="field-steps">
          {(STEPS[site.kind] ?? []).map((s) => (
            <button key={s} className={`btn${step === s ? ' on' : ''}`} onClick={() => setStep(s)}>
              {t(`steps.${s}` as never)}
            </button>
          ))}
        </div>
      )}
      {step && (
        <ScanScreen
          body={body}
          ready={!!siteId}
          onAnswer={() => void refresh().catch(() => undefined)}
          header={
            <>
              {['outbound', 'hub_receive'].includes(step) && (
                <label>
                  {t('bagSeal')}
                  <input value={seal} onChange={(e) => setSeal(e.target.value)} dir="ltr" />
                </label>
              )}
              {step === 'car_load' && (
                <label>
                  {t('car')}
                  <select aria-label={t('car')} value={carId} onChange={(e) => setCarId(e.target.value)}>
                    <option value="" />
                    {cars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.driverName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {step === 'dispatch' && (
                <label>
                  {t('run')}
                  <select aria-label={t('run')} value={runId} onChange={(e) => setRunId(e.target.value)}>
                    <option value="" />
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.courierId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          }
        />
      )}
    </main>
  );
}
