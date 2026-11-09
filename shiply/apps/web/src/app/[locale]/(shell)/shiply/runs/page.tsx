'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { SitePicker, useLookups, useSite } from '../shared';

interface Run {
  id: string;
  hubId: string;
  courierId: string;
  date: string;
  status: string;
}
interface Suggestion {
  courierId: string;
  name: string;
  nameAr: string;
  openParcels: number;
}

/** Dispatch: pick a zone, the screen suggests the courier who covers it, the supervisor starts his run. */
export default function RunsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const me = useMe();
  const look = useLookups();
  const [hubId, setHub, options] = useSite('last_mile_hub', look.sites);
  const [zoneId, setZone] = useState('');
  const [suggest, setSuggest] = useState<Suggestion[]>([]);
  const [rows, setRows] = useState<Run[] | null>(null);
  const load = useCallback(async () => {
    if (hubId) setRows(await api<Run[]>(`/parcels/runs?hub=${hubId}`));
  }, [hubId]);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  useEffect(() => {
    if (hubId && zoneId) api<Suggestion[]>(`/parcels/hub/${hubId}/suggest?zone=${zoneId}`).then(setSuggest, () => toast.error(t('common.failed')));
    else setSuggest([]);
  }, [hubId, zoneId, t]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  const canUse = atLeast(me.access.shiply, 'use');
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <div className="inline-form card">
        <SitePicker label={t('shiply.hub')} value={hubId} onChange={setHub} options={options} render={look.label} />
        <label>
          {t('shiply.zone')}
          <select aria-label={t('shiply.zone')} value={zoneId} onChange={(e) => setZone(e.target.value)}>
            <option value="" />
            {look.zones.filter((z) => z.hubId === hubId).map((z) => (
              <option key={z.id} value={z.id}>
                {look.label(z)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {suggest.length > 0 && (
        <div className="card">
          <h2>{t('shiply.suggested')}</h2>
          {suggest.map((s) => (
            <div key={s.courierId} className="row-actions" data-testid="suggestion">
              <strong>{locale === 'ar' ? s.nameAr : s.name}</strong>
              <span>{t('shiply.openParcels', { count: s.openParcels })}</span>
              {canUse && (
                <button className="btn primary" onClick={() => void run(() => api('/parcels/runs', { method: 'POST', json: { hubId, courierId: s.courierId } }))}>
                  {t('shiply.startRun')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ListPage<Run>
        title={t('shiply.runs')}
        columns={[
          { key: 'date', label: t('shiply.date'), render: (r) => r.date.slice(0, 10) },
          { key: 'courier', label: t('shiply.courier'), render: (r) => look.person(r.courierId) },
          { key: 'status', label: t('shiply.status'), render: (r) => <span className="pill">{t(`shiply.rstatus.${r.status}` as never)}</span> },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              canUse && r.status !== 'closed' ? (
                <div className="row-actions">
                  {r.status === 'open' && <button className="btn" onClick={() => void run(() => api(`/parcels/runs/${r.id}/out`, { method: 'POST' }))}>{t('shiply.out')}</button>}
                  <button className="btn" onClick={() => void run(() => api(`/parcels/runs/${r.id}/close`, { method: 'POST' }))}>
                    {t('shiply.closeRun')}
                  </button>
                </div>
              ) : null,
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!!hubId && !rows}
      />
    </AppShell>
  );
}
