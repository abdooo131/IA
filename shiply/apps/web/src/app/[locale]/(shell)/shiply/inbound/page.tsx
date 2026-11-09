'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { SHIPLY_MENU } from '../menu';
import { SitePicker, useLookups, useSite } from '../shared';

interface Car {
  pickupId: string;
  courierId: string | null;
  merchantId: string;
  expected: number;
  received: number;
}
interface Inbound {
  cars: Car[];
  merchants: { merchantId: string; expected: number; received: number }[];
  expected: number;
  received: number;
}

export default function InboundPage() {
  const t = useTranslations();
  const me = useMe();
  const look = useLookups();
  const [siteId, setSite, options] = useSite('sorting_facility', look.sites);
  const [data, setData] = useState<Inbound | null>(null);
  const load = useCallback(async () => {
    if (siteId) setData(await api<Inbound>(`/parcels/facility/${siteId}/inbound`));
  }, [siteId]);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const close = async (pickupId: string) => {
    if (!(await confirm({ title: t('shiply.closeCar'), body: t('shiply.closeCarBody') }))) return;
    try {
      await api(`/parcels/facility/${siteId}/inbound/close`, { method: 'POST', json: { pickupId } });
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'shiply'));
    }
  };
  return (
    <AppShell app="shiply" menu={SHIPLY_MENU}>
      <div className="inline-form card">
        <SitePicker label={t('shiply.site')} value={siteId} onChange={setSite} options={options} render={look.label} />
        {data && (
          <strong>
            {t('shiply.received')} {data.received} / {t('shiply.expected')} {data.expected}
          </strong>
        )}
      </div>
      <ListPage<Car & { id: string }>
        title={t('shiply.inbound')}
        columns={[
          { key: 'courier', label: t('shiply.courier'), render: (r) => look.person(r.courierId) },
          { key: 'merchant', label: t('shiply.merchant'), render: (r) => look.merchant(r.merchantId) },
          { key: 'expected', label: t('shiply.expected'), render: (r) => <span data-testid="expected">{r.expected}</span> },
          { key: 'received', label: t('shiply.received'), render: (r) => <span data-testid="received">{r.received}</span> },
          {
            key: 'close',
            label: '',
            render: (r) => (atLeast(me.access.shiply, 'use') ? <button className="btn" onClick={() => void close(r.pickupId)}>{t('shiply.closeCar')}</button> : null),
          },
        ]}
        rows={(data?.cars ?? []).map((c) => ({ ...c, id: c.pickupId }))}
        total={data?.cars.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!!siteId && !data}
      />
    </AppShell>
  );
}
