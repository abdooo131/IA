'use client';
import { useHub } from '@/parcels/components/HubContext';
import { ScanBox } from '@/parcels/components/ScanBox';
import { StatCard } from '@/parcels/components/StatCard';
import { Card, Empty, Loading, PageHeader } from '@/parcels/components/ui';
import { api } from '@/parcels/lib/api';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';
import { OutboundBags } from '../trips/OutboundBags';

type Lane = { hubId: string; code: string; name: string; parcels: number };

/**
 * Sorting facility: the sorting team scans each parcel and the system names its lane.
 * Last mile hub: this page is "Send back", where staff scan returns straight into the bag.
 */
export default function SortPage() {
  const hub = useHub();
  const t = useT();
  const lanes = useLoad<Lane[]>(hub.isSorting ? `/hubs/${hub.id}/lanes` : null);

  if (!hub.isSorting) {
    return (
      <>
        <PageHeader
          eyebrow={t('Last mile hub')}
          title={`${t('Send back')} · ${hub.name}`}
          subtitle={t(
            'Scan each return into the bag for the sorting facility, seal it, then send it on a truck from Trips.',
          )}
        />
        <OutboundBags />
      </>
    );
  }

  const list = lanes.data ?? [];
  return (
    <>
      <PageHeader
        eyebrow={t('Sorting facility')}
        title={`${t('Sorting')} · ${hub.name}`}
        subtitle={t(
          'Sorting team: scan each parcel inbound handed over. The screen shows its lane; put it there. The outbound team scans it from the lane into a bag, which completes the handover.',
        )}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          label={t('Parcels on lanes')}
          value={String(list.reduce((n, l) => n + l.parcels, 0))}
          icon="packaging"
          tone="in-progress"
        />
        <StatCard
          label={t('Lanes in use')}
          value={String(list.length)}
          icon="route"
          tone="heading-to-customer"
        />
      </div>
      <Card title={t('Sort a parcel')}>
        <ScanBox
          label={t('Parcel tracking number')}
          onScan={async (code) => {
            const r = await api(`/hubs/${hub.id}/sort`, { body: { code } });
            void lanes.reload();
            if (!r.lane)
              return {
                big: t('RETURN'),
                tone: 'return' as const,
                text: t('Return shelf for {merchant}', { merchant: r.next?.merchantName ?? '' }),
              };
            return {
              big: r.lane,
              text: t('Put it on lane {code} ({hub})', { code: r.lane, hub: r.next.hubName }),
            };
          }}
        />
      </Card>
      <Card title={t('Lanes waiting for outbound')} className="mt-4">
        {!lanes.data ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>{t('All lanes are empty.')}</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {list.map((l) => (
              <div key={l.hubId} className="rounded-xl bg-surface-raised p-4 text-center">
                <p className="ltr-iso text-h2">{l.code}</p>
                <p className="truncate text-caption text-text-muted">{l.name}</p>
                <p className="tabular mt-2 text-number-lg">{l.parcels}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
