'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { SHIPLY_MENU } from '../menu';
import { StatusPill, useLookups } from '../shared';

interface Attempt {
  id: string;
  tracking: string;
  number: number;
  reason: string | null;
  at: string;
  parcelStatus: string;
  merchantId: string;
  hubId: string | null;
}

export default function AttemptsPage() {
  const t = useTranslations();
  const look = useLookups();
  const [rows, setRows] = useState<Attempt[] | null>(null);
  useEffect(() => {
    api<Attempt[]>('/parcels/attempts?result=failed').then(setRows, () => toast.error(t('common.failed')));
  }, [t]);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Attempt>
        title={t('shiply.failed')}
        columns={[
          { key: 'tracking', label: t('shiply.tracking'), render: (r) => <span dir="ltr">{r.tracking}</span> },
          { key: 'merchant', label: t('shiply.merchant'), render: (r) => look.merchant(r.merchantId) },
          { key: 'hub', label: t('shiply.hub'), render: (r) => look.site(r.hubId) },
          { key: 'number', label: t('shiply.attempts'), render: (r) => r.number },
          { key: 'reason', label: t('shiply.reason'), render: (r) => (r.reason ? t(`shiply.reasons.${r.reason}` as never) : '') },
          { key: 'when', label: t('shiply.when'), render: (r) => new Date(r.at).toLocaleString() },
          { key: 'status', label: t('shiply.status'), render: (r) => <StatusPill status={r.parcelStatus} /> },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}
