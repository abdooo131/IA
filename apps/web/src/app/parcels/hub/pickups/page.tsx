'use client';
import { useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { Icon } from '@/parcels/components/Icon';
import { StatCard } from '@/parcels/components/StatCard';
import { Alert, Badge, Card, Empty, Loading, PageHeader, Select } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { shortDate } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type Pickup = {
  id: string;
  code: string;
  date: string;
  status: string;
  courierId: string | null;
  expectedCount: number;
  notes: string;
  merchant: { name: string; phone: string; pickupAddress: string };
};

export default function PickupsPage() {
  const hub = useHub();
  const t = useT();
  const pickups = useLoad<Pickup[]>(`/hubs/${hub.id}/pickups`);
  const couriers = useLoad<{ id: string; name: string }[]>(`/hubs/${hub.id}/couriers`);
  const [error, setError] = useState<string | null>(null);

  const assign = async (p: Pickup, courierId: string) => {
    setError(null);
    try {
      await api(`/hubs/${hub.id}/pickups/${p.id}/assign`, { body: { courierId } });
      await pickups.reload();
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  const list = pickups.data ?? [];
  const label = (s: string) =>
    ({
      REQUESTED: t('Needs a courier'),
      ASSIGNED: t('Courier assigned'),
      COLLECTED: t('On the way here'),
    })[s] ?? s;

  return (
    <>
      <PageHeader
        eyebrow={t('Sorting facility')}
        title={`${t('Pickups')} · ${hub.name}`}
        subtitle={t(
          'Merchants nearest this facility ask for pickups. Give each one to a first mile courier; the inbound team receives the parcels.',
        )}
      />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard
          label={t('Needs a courier')}
          value={String(list.filter((p) => p.status === 'REQUESTED').length)}
          icon="alert"
          tone="needs-action"
          alert={list.some((p) => p.status === 'REQUESTED')}
        />
        <StatCard
          label={t('Courier assigned')}
          value={String(list.filter((p) => p.status === 'ASSIGNED').length)}
          icon="courier"
          tone="in-progress"
        />
        <StatCard
          label={t('On the way here')}
          value={String(list.filter((p) => p.status === 'COLLECTED').length)}
          icon="pickups"
          tone="heading-to-customer"
        />
      </div>
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!pickups.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>{t('No open pickups.')}</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card
              key={p.id}
              title={p.merchant.name}
              actions={
                <Badge
                  tone={
                    p.status === 'REQUESTED' ? 'amber' : p.status === 'COLLECTED' ? 'green' : 'blue'
                  }
                >
                  {label(p.status)}
                </Badge>
              }
            >
              <div className="space-y-2 text-body-sm">
                <p className="flex gap-2">
                  <Icon name="schedule" size={18} className="text-text-muted" />
                  {shortDate(p.date)} · <span className="ltr-iso">{p.code}</span>
                </p>
                <p className="flex gap-2">
                  <Icon name="store" size={18} className="text-text-muted" />
                  {p.merchant.pickupAddress}
                </p>
                <p className="flex gap-2">
                  <Icon name="support" size={18} className="text-text-muted" />
                  <a className="ltr-iso font-bold text-link" href={`tel:${p.merchant.phone}`}>
                    {p.merchant.phone}
                  </a>
                </p>
                <p className="flex gap-2">
                  <Icon name="orders" size={18} className="text-text-muted" />
                  {t('About {n} parcels', { n: p.expectedCount })}
                </p>
                {p.notes && (
                  <p className="rounded-md bg-surface-raised px-3 py-2 text-caption">{p.notes}</p>
                )}
              </div>
              {(p.status === 'REQUESTED' || p.status === 'ASSIGNED') && (
                <label className="mt-4 block">
                  <span className="mb-1 block text-caption font-semibold">{t('Courier')}</span>
                  <Select
                    value={p.courierId ?? ''}
                    onChange={(e) => e.target.value && void assign(p, e.target.value)}
                  >
                    <option value="">{t('Choose a courier')}</option>
                    {couriers.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
