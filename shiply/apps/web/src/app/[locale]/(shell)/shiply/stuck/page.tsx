'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { SHIPLY_MENU } from '../menu';
import { SitePicker, StatusPill, useLookups, useSite } from '../shared';

interface Stuck {
  parcelId: string;
  tracking: string;
  status: string;
  since: string;
  lastScanById: string | null;
}

export default function StuckPage() {
  const t = useTranslations();
  const look = useLookups();
  const [siteId, setSite, options] = useSite('sorting_facility', look.sites);
  const [rows, setRows] = useState<Stuck[] | null>(null);
  useEffect(() => {
    if (siteId) api<Stuck[]>(`/parcels/facility/${siteId}/stuck`).then(setRows, () => toast.error(t('common.failed')));
  }, [siteId, t]);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <div className="inline-form card">
        <SitePicker label={t('shiply.site')} value={siteId} onChange={setSite} options={options} render={look.label} />
      </div>
      <ListPage<Stuck & { id: string }>
        title={t('shiply.stuck')}
        columns={[
          { key: 'tracking', label: t('shiply.tracking'), render: (r) => <span dir="ltr">{r.tracking}</span> },
          { key: 'status', label: t('shiply.status'), render: (r) => <StatusPill status={r.status} /> },
          { key: 'since', label: t('shiply.waiting'), render: (r) => new Date(r.since).toLocaleString() },
          { key: 'who', label: t('shiply.lastScan'), render: (r) => r.lastScanById ?? '' },
        ]}
        rows={(rows ?? []).map((r) => ({ ...r, id: r.parcelId }))}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!!siteId && !rows}
      />
    </AppShell>
  );
}
