'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { SHIPLY_MENU } from '../menu';
import { StatusPill, useLookups } from '../shared';
import type { Parcel } from '../parcels/page';

/** Parcels going back to their merchant: on hold at a hub, in a return bag, or at the merchant's facility. */
export default function ReturnsPage() {
  const t = useTranslations();
  const router = useRouter();
  const look = useLookups();
  const [rows, setRows] = useState<Parcel[] | null>(null);
  useEffect(() => {
    Promise.all(['on_hold', 'at_outbound', 'in_transit', 'at_inbound'].map((s) => api<{ rows: Parcel[] }>(`/parcels?status=${s}`)))
      .then((r) => setRows(r.flatMap((x) => x.rows).filter((p) => p.direction === 'return')))
      .catch(() => toast.error(t('common.failed')));
  }, [t]);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Parcel>
        title={t('shiply.returns')}
        columns={[
          { key: 'tracking', label: t('shiply.tracking'), render: (r) => <span dir="ltr">{r.tracking}</span> },
          { key: 'merchant', label: t('shiply.merchant'), render: (r) => look.merchant(r.merchantId) },
          { key: 'hub', label: t('shiply.hub'), render: (r) => look.site(r.hubId) },
          { key: 'attempts', label: t('shiply.attempts'), render: (r) => r.attempts },
          { key: 'status', label: t('shiply.status'), render: (r) => <StatusPill status={r.status} /> },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        onRowClick={(r) => router.push(`/shiply/parcels/${r.id}`)}
        loading={!rows}
      />
    </AppShell>
  );
}
