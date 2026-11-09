'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { useRouter } from '@/i18n/routing';
import { AppShell } from '@/shell/AppShell';
import { Icon } from '@/shell/Icon';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { Badge, parcelTone } from '@/ui/Badge';
import { Drawer } from '@/ui/Drawer';
import { SHIPLY_MENU } from '../menu';
import { useLookups } from '../shared';
import { NewParcelForm } from './NewParcelForm';

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

const CHIPS = ['', 'created', 'picked_up', 'at_inbound', 'sorted', 'in_transit', 'at_hub', 'out_for_delivery', 'attempt_failed', 'on_hold', 'delivered', 'returned'];

export default function ParcelsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const router = useRouter();
  const look = useLookups();
  const [f, setF] = useState({ status: '', hub: '', merchant: '', q: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Parcel[]; total: number } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s) setF((x) => ({ ...x, status: s }));
    api<{ byStatus: Record<string, number> }>('/parcels/overview').then((o) => setCounts(o.byStatus), () => undefined);
  }, []);
  const load = useCallback(() => {
    setData(null);
    const qs = new URLSearchParams({ ...f, page: String(page) });
    return api<{ rows: Parcel[]; total: number }>(`/parcels?${qs}`).then(setData, () => toast.error(t('common.failed')));
  }, [f, page, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const set = (k: keyof typeof f) => (v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  const all = Object.values(counts).reduce((s, n) => s + n, 0);
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <ListPage<Parcel>
        title={t('shiply.parcels')}
        subtitle={data ? t('shiply.parcelCount', { count: data.total }) : ' '}
        emptyIcon="orders"
        action={
          atLeast(me.access.shiply, 'use') ? (
            <button className="btn primary" onClick={() => setDrawer(true)}>
              <Icon name="new" size={18} />
              {t('shiply.newParcel')}
            </button>
          ) : null
        }
        above={
          <div className="chips" role="tablist" aria-label={t('shiply.status')}>
            {CHIPS.map((s) => (
              <button key={s || 'all'} role="tab" aria-selected={f.status === s} className={`chip${f.status === s ? ' active' : ''}`} onClick={() => set('status')(s)}>
                {s ? t(`shiply.statuses.${s}` as never) : t('shiply.all')}
                <span className="count">{s ? (counts[s] ?? 0) : all}</span>
              </button>
            ))}
          </div>
        }
        filters={
          <>
            <input type="search" aria-label={t('shiply.search')} placeholder={t('shiply.search')} value={f.q} onChange={(e) => set('q')(e.target.value)} />
            <select aria-label={t('shiply.hub')} value={f.hub} onChange={(e) => set('hub')(e.target.value)}>
              <option value="">{`${t('shiply.hub')}: ${t('shiply.all')}`}</option>
              {look.sites.filter((s) => s.kind === 'last_mile_hub').map((s) => (
                <option key={s.id} value={s.id}>
                  {look.label(s)}
                </option>
              ))}
            </select>
            <select aria-label={t('shiply.merchant')} value={f.merchant} onChange={(e) => set('merchant')(e.target.value)}>
              <option value="">{`${t('shiply.merchant')}: ${t('shiply.all')}`}</option>
              {look.merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        }
        columns={[
          {
            key: 'tracking',
            label: t('shiply.tracking'),
            render: (r) => (
              <>
                <span className="cell-main mono" dir="ltr">
                  {r.tracking}
                </span>
                <span className="cell-sub">{look.merchant(r.merchantId)}</span>
              </>
            ),
          },
          {
            key: 'customer',
            label: t('shiply.customerName'),
            render: (r) => (
              <>
                <span className="cell-main">{r.customerName}</span>
                <span className="cell-sub" dir="ltr">
                  {r.phone}
                </span>
              </>
            ),
          },
          {
            key: 'route',
            label: t('shiply.route'),
            render: (r) =>
              r.zoneId ? (
                <>
                  <span className="cell-main">{look.zone(r.zoneId)}</span>
                  <span className="cell-sub">{`${look.site(r.originFacilityId)} → ${look.site(r.hubId)}`}</span>
                </>
              ) : (
                <Badge tone="needs">{t('shiply.noRoute')}</Badge>
              ),
          },
          { key: 'cod', label: t('shiply.cod'), render: (r) => <span className="cell-main mono">{formatEgp(r.codAmount, locale)}</span> },
          { key: 'status', label: t('shiply.status'), render: (r) => <Badge tone={parcelTone(r.status)}>{t(`shiply.statuses.${r.status}` as never)}</Badge> },
          {
            key: 'created',
            label: t('shiply.created'),
            render: (r) => <span className="cell-sub">{new Date(r.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' })}</span>,
          },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        onRowClick={(r) => router.push(`/shiply/parcels/${r.id}`)}
        loading={!data}
      />
      <Drawer open={drawer} title={t('shiply.newParcel')} onClose={() => setDrawer(false)} closeLabel={t('common.close')}>
        <NewParcelForm merchants={look.merchants} onCancel={() => setDrawer(false)} onCreated={(id) => router.push(`/shiply/parcels/${id}`)} />
      </Drawer>
    </AppShell>
  );
}
