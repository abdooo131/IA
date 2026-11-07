'use client';
import { Fragment, useState } from 'react';
import { useHub } from '@/components/HubContext';
import { ScanBox } from '@/components/ScanBox';
import { StatCard } from '@/components/StatCard';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type Bag = { id: string; code: string; originHubId: string; destinationHubId: string; status: string; parcels: number; createdAt: string; tripId: string | null };
type Hub = { id: string; code: string; name: string };

export default function SortPage() {
  const hub = useHub();
  const t = useT();
  const bags = useLoad<Bag[]>(`/hubs/${hub.id}/bags`);
  const hubs = useLoad<Hub[]>('/reference/hubs');
  const [open, setOpen] = useState<string | null>(null);
  const [contents, setContents] = useState<{ trackingNumber: string; customerName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hubCode = (id: string) => hubs.data?.find((h) => h.id === id)?.code ?? '';
  const hubName = (id: string) => hubs.data?.find((h) => h.id === id)?.name ?? '';

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await bags.reload();
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  const show = async (bag: Bag) => {
    if (open === bag.id) return setOpen(null);
    const b = await api(`/hubs/${hub.id}/bags/${bag.id}`);
    setContents(b.parcels);
    setOpen(bag.id);
  };

  const outgoing = (bags.data ?? []).filter((b) => b.originHubId === hub.id);
  const openBags = outgoing.filter((b) => b.status === 'OPEN');
  const sealed = outgoing.filter((b) => b.status === 'SEALED');
  const statusText = (b: Bag) =>
    b.status === 'OPEN' ? t('Open') : b.status === 'HANDED_OVER' ? (b.tripId ? t('With outbound, on a truck') : t('With outbound')) : hub.isSorting ? t('Sealed, waiting for outbound') : t('Sealed');

  return (
    <>
      <PageHeader
        eyebrow={hub.isSorting ? t('Sorting facility') : t('Last mile hub')}
        title={`${hub.isSorting ? t('Sorting') : t('Send back')} · ${hub.name}`}
        subtitle={hub.isSorting
          ? t('Sorting team: scan each parcel inbound handed over. The system picks its bag (its last mile hub or the next facility) or the return shelf. Seal full bags; outbound takes them over.')
          : t('Scan returns and rerouted parcels into the bag for the sorting facility, seal it, then send it on a trip.')}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t('Open bags')} value={String(openBags.length)} icon="packaging" tone="in-progress" />
        <StatCard label={t('Parcels in open bags')} value={String(openBags.reduce((n, b) => n + b.parcels, 0))} icon="orders" tone="new" />
        <StatCard label={t('Sealed, waiting for outbound')} value={String(sealed.length)} icon="route" tone="heading-to-customer" alert={sealed.length > 0} />
      </div>
      <Card title={t('Sort a parcel')}>
        <ScanBox
          label={t('Parcel tracking number')}
          onScan={async (code) => {
            const r = await api(`/hubs/${hub.id}/sort`, { body: { code } });
            void bags.reload();
            if (!r.bag) return { big: t('RETURN'), tone: 'return' as const, text: t('Return shelf for {merchant}', { merchant: r.next?.merchantName ?? '' }) };
            return { big: r.next.hubCode, text: t('Bag {bag} for {hub}', { bag: r.bag.code, hub: r.next.hubName }) };
          }}
        />
      </Card>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <Card title={t('Bags leaving here')} className="mt-4">
        {!bags.data ? <Loading /> : outgoing.length === 0 ? <Empty>{t('No bags yet. Sorting a parcel opens one.')}</Empty> : (
          <Table head={[t('Bag'), t('To'), t('Parcels'), t('Status'), t('Opened'), '']}>
            {outgoing.map((b) => (
              <Fragment key={b.id}>
                <tr>
                  <Td><span className="ltr-iso font-mono font-bold">{b.code}</span></Td>
                  <Td><span className="ltr-iso text-h3">{hubCode(b.destinationHubId)}</span> <span className="text-caption text-text-muted">{hubName(b.destinationHubId)}</span></Td>
                  <Td className="tabular">{b.parcels}</Td>
                  <Td><Badge tone={b.status === 'OPEN' ? 'amber' : b.status === 'HANDED_OVER' ? 'green' : 'blue'}>{statusText(b)}</Badge></Td>
                  <Td>{dateTime(b.createdAt)}</Td>
                  <Td className="space-x-2 rtl:space-x-reverse">
                    <Button tone="ghost" onClick={() => void show(b)}>{open === b.id ? t('Hide') : t('Contents')}</Button>
                    {b.status === 'OPEN' && <Button tone="accent" onClick={() => void act(() => api(`/hubs/${hub.id}/bags/${b.id}/seal`, { body: {} }))}>{t('Seal')}</Button>}
                  </Td>
                </tr>
                {open === b.id && (
                  <tr>
                    <td colSpan={6} className="bg-surface-raised px-3 py-2">
                      <ul className="space-y-1 text-body-sm">
                        {contents.map((p) => (
                          <li key={p.trackingNumber} className="flex items-center justify-between gap-2">
                            <span><span className="ltr-iso font-mono">{p.trackingNumber}</span> · {p.customerName}</span>
                            {b.status === 'OPEN' && (
                              <Button tone="ghost" onClick={() => void act(async () => {
                                await api(`/hubs/${hub.id}/bags/${b.id}/remove`, { body: { code: p.trackingNumber } });
                                setContents((c) => c.filter((x) => x.trackingNumber !== p.trackingNumber));
                              })}>{t('Take out')}</Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
