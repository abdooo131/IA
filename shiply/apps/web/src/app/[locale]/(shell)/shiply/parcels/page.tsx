'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { Link, useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { StatusPill, useLookups } from '../shared';

export interface Parcel {
  id: string;
  tracking: string;
  merchantId: string;
  customerName: string;
  phone: string;
  addressText: string;
  zoneId: string | null;
  hubId: string | null;
  facilityId: string | null;
  originFacilityId: string | null;
  codAmount: number;
  price: number | null;
  status: string;
  direction: string;
  attempts: number;
  courierId: string | null;
  createdAt: string;
}

const STATUSES = ['created', 'picked_up', 'at_inbound', 'sorted', 'at_outbound', 'in_transit', 'at_hub', 'on_hold', 'out_for_delivery', 'attempt_failed', 'delivered', 'returned', 'cancelled', 'lost'];

export default function ParcelsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const router = useRouter();
  const look = useLookups();
  const [f, setF] = useState({ status: '', hub: '', merchant: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Parcel[]; total: number } | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s) setF((x) => ({ ...x, status: s }));
  }, []);
  useEffect(() => {
    const qs = new URLSearchParams({ ...f, page: String(page) });
    api<{ rows: Parcel[]; total: number }>(`/parcels?${qs}`).then(setData, () => toast.error(t('common.failed')));
  }, [f, page, t]);
  const set = (k: keyof typeof f) => (v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Parcel>
        title={t('shiply.parcels')}
        action={
          atLeast(me.access.shiply, 'use') ? (
            <Link className="btn primary" href="/shiply/parcels/new">
              {t('shiply.newParcel')}
            </Link>
          ) : null
        }
        filters={
          <>
            <input type="search" aria-label={t('shiply.search')} placeholder={t('shiply.search')} value={f.q} onChange={(e) => set('q')(e.target.value)} />
            <select aria-label={t('shiply.status')} value={f.status} onChange={(e) => set('status')(e.target.value)}>
              <option value="">{t('shiply.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`shiply.statuses.${s}` as never)}
                </option>
              ))}
            </select>
            <select aria-label={t('shiply.hub')} value={f.hub} onChange={(e) => set('hub')(e.target.value)}>
              <option value="">{t('shiply.all')}</option>
              {look.sites.filter((s) => s.kind === 'last_mile_hub').map((s) => (
                <option key={s.id} value={s.id}>
                  {look.label(s)}
                </option>
              ))}
            </select>
            <select aria-label={t('shiply.merchant')} value={f.merchant} onChange={(e) => set('merchant')(e.target.value)}>
              <option value="">{t('shiply.all')}</option>
              {look.merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        }
        columns={[
          { key: 'tracking', label: t('shiply.tracking'), render: (r) => <span dir="ltr">{r.tracking}</span> },
          { key: 'merchant', label: t('shiply.merchant'), render: (r) => look.merchant(r.merchantId) },
          { key: 'customer', label: t('shiply.customerName'), render: (r) => r.customerName },
          { key: 'zone', label: t('shiply.zone'), render: (r) => (r.zoneId ? look.zone(r.zoneId) : t('shiply.noRoute')) },
          { key: 'cod', label: t('shiply.cod'), render: (r) => formatEgp(r.codAmount, locale) },
          { key: 'status', label: t('shiply.status'), render: (r) => <StatusPill status={r.status} /> },
          { key: 'created', label: t('shiply.created'), render: (r) => new Date(r.createdAt).toLocaleDateString() },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        onRowClick={(r) => router.push(`/shiply/parcels/${r.id}`)}
        loading={!data}
      />
    </AppShell>
  );
}
