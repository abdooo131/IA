'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Link } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { toast } from '@/shell/feedback';
import { SHIPLY_MENU } from './menu';
import { useLookups } from './shared';

interface Overview {
  byStatus: Record<string, number>;
  late: number;
  failureByHub: { hubId: string; attempts: number; failed: number; rate: number }[];
}

const FLOW = ['created', 'picked_up', 'at_inbound', 'sorted', 'at_outbound', 'in_transit', 'at_hub', 'out_for_delivery', 'attempt_failed', 'on_hold', 'delivered', 'returned'];

export default function ShiplyOverview() {
  const t = useTranslations();
  const look = useLookups();
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    api<Overview>('/parcels/overview').then(setO, () => toast.error(t('common.failed')));
  }, [t]);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <h1>{t('shiply.overview')}</h1>
      <div className="tiles-numbers">
        {FLOW.map((s) => (
          <Link key={s} className="card number" href={`/shiply/parcels?status=${s}`}>
            <strong>{o?.byStatus[s] ?? 0}</strong>
            <span>{t(`shiply.statuses.${s}` as never)}</span>
          </Link>
        ))}
        <div className="card number">
          <strong>{o?.late ?? 0}</strong>
          <span>{t('shiply.late')}</span>
        </div>
      </div>
      <h2>{t('shiply.failureRate')}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>{t('shiply.hub')}</th>
            <th>{t('shiply.attemptsCount')}</th>
            <th>{t('shiply.failedCount')}</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {(o?.failureByHub ?? []).map((h) => (
            <tr key={h.hubId}>
              <td>{look.site(h.hubId)}</td>
              <td>{h.attempts}</td>
              <td>{h.failed}</td>
              <td>{(h.rate / 100).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}
