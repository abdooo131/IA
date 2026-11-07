'use client';
import { Fragment, useState } from 'react';
import { useHub } from '@/parcels/components/HubContext';
import { ScanBox } from '@/parcels/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Loading, Table, Td } from '@/parcels/components/ui';
import { api, errorMessage } from '@/parcels/lib/api';
import { dateTime } from '@/parcels/lib/format';
import { useLoad } from '@/parcels/lib/hooks';
import { useT } from '@/parcels/lib/i18n';

type Bag = { id: string; code: string; originHubId: string; destinationHubId: string; status: string; parcels: number; createdAt: string; tripId: string | null };
type Hub = { id: string; code: string; name: string };
type Lane = { hubId: string; code: string; name: string; parcels: number };

/**
 * The outbound team's bagging: scan each parcel from its lane into the bag for its next place.
 * That scan completes the handover from sorting. Then seal the bag for the truck.
 */
export function OutboundBags({ onChange }: { onChange?: () => void }) {
  const hub = useHub();
  const t = useT();
  const bags = useLoad<Bag[]>(`/hubs/${hub.id}/bags`);
  const hubs = useLoad<Hub[]>('/reference/hubs');
  const lanes = useLoad<Lane[]>(hub.isSorting ? `/hubs/${hub.id}/lanes` : null);
  const [open, setOpen] = useState<string | null>(null);
  const [contents, setContents] = useState<{ trackingNumber: string; customerName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const code = (id: string) => hubs.data?.find((h) => h.id === id)?.code ?? '';
  const name = (id: string) => hubs.data?.find((h) => h.id === id)?.name ?? '';

  const refresh = async () => {
    await Promise.all([bags.reload(), lanes.reload()]);
    onChange?.();
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
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

  const mine = (bags.data ?? []).filter((b) => b.originHubId === hub.id);

  return (
    <>
      <Card title={t('Scan parcels into bags')}>
        <ScanBox
          label={hub.isSorting ? t('Parcel from a lane') : t('Return parcel')}
          onScan={async (c) => {
            const r = await api(`/hubs/${hub.id}/outbound/bag`, { body: { code: c } });
            void refresh();
            return { big: r.next?.hubCode ?? r.bag.code, text: t('Bag {bag} for {hub} · {n} parcels', { bag: r.bag.code, hub: r.next?.hubName ?? '', n: r.count ?? '' }), warn: r.warning ? t(r.warning) : undefined };
          }}
        />
        {hub.isSorting && (lanes.data ?? []).length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-caption font-semibold text-text-muted">{t('Still on lanes, not handed over to outbound')}</p>
            <div className="flex flex-wrap gap-2">
              {(lanes.data ?? []).map((l) => <Badge key={l.hubId} tone="amber"><span className="ltr-iso">{l.code}</span>&nbsp;· {l.parcels}</Badge>)}
            </div>
          </div>
        )}
      </Card>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <Card title={t('Bags')} className="mt-4">
        {!bags.data ? <Loading /> : mine.length === 0 ? <Empty>{t('No bags yet. Scanning a parcel opens one.')}</Empty> : (
          <Table head={[t('Bag'), t('To'), t('Parcels'), t('Status'), t('Opened'), '']}>
            {mine.map((b) => (
              <Fragment key={b.id}>
                <tr>
                  <Td><span className="ltr-iso font-mono font-bold">{b.code}</span></Td>
                  <Td><span className="ltr-iso text-h3">{code(b.destinationHubId)}</span> <span className="text-caption text-text-muted">{name(b.destinationHubId)}</span></Td>
                  <Td className="tabular">{b.parcels}</Td>
                  <Td><Badge tone={b.status === 'OPEN' ? 'amber' : 'green'}>{b.status === 'OPEN' ? t('Open') : b.tripId ? t('Sealed, on a truck') : t('Sealed, ready to load')}</Badge></Td>
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
                                setContents((x) => x.filter((y) => y.trackingNumber !== p.trackingNumber));
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
