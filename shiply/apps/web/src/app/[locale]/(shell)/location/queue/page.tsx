'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api, ApiError } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { PlacePicker } from '@/shell/PlacePicker';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { LOCATION_MENU } from '../menu';

interface Decision {
  id: string;
  service: string;
  refId: string;
  input: string;
  ageMinutes: number;
  candidates: { id: string; label: string }[];
}

export default function QueuePage() {
  const t = useTranslations();
  const me = useMe();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Decision[]; total: number } | null>(null);
  const [picking, setPicking] = useState<Decision | null>(null);
  const load = useCallback(() => api<{ rows: Decision[]; total: number }>(`/location/queue?page=${page}`).then(setData, () => toast.error(t('common.failed'))), [page, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const canWork = atLeast(me.access.location, 'use');
  const age = (m: number) => (m < 60 ? t('location.minutes', { n: m }) : t('location.hours', { n: Math.floor(m / 60) }));
  const pick = async (placeId: string) => {
    if (!picking) return;
    try {
      await api(`/location/queue/${picking.id}/pick`, { method: 'POST', json: { placeId } });
      toast.success(t('location.picked'));
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 409 ? t('location.errors.already_resolved') : t('common.failed'));
    }
    setPicking(null);
    await load();
  };
  return (
    <AppShell app="location" menu={LOCATION_MENU}>
      <ListPage<Decision>
        title={t('location.queue')}
        columns={[
          { key: 'input', label: t('location.address'), render: (r) => <span dir="auto">{r.input}</span> },
          { key: 'service', label: t('location.service'), render: (r) => `${t(`apps.${r.service}`)} · ${r.refId}` },
          { key: 'candidates', label: t('location.guesses'), render: (r) => r.candidates.map((c) => c.label).join(' / ') || '' },
          { key: 'age', label: t('location.waiting'), render: (r) => age(r.ageMinutes) },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              canWork ? (
                <div className="row-actions">
                  <button className="btn primary" onClick={() => setPicking(r)}>
                    {t('location.pickArea')}
                  </button>
                  <button className="btn ghost" disabled title={t('location.laterNote')}>
                    {t('location.sendLink')}
                  </button>
                  <button className="btn ghost" disabled title={t('location.laterNote')}>
                    {t('location.call')}
                  </button>
                </div>
              ) : null,
          },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        loading={!data}
      />
      {picking && <PlacePicker title={t('location.pickTitle')} suggestions={picking.candidates} onPick={pick} onClose={() => setPicking(null)} />}
    </AppShell>
  );
}
