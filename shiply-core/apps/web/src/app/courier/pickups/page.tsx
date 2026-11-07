'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ScanBox } from '@/components/ScanBox';
import { Alert, Badge, Button, Card, Empty, Loading } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type Pickup = { id: string; code: string; date: string; status: string; expectedCount: number; collected: number; notes: string; merchant: { name: string; phone: string; pickupAddress: string } };

export default function CourierPickupsPage() {
  const t = useT();
  const pickups = useLoad<Pickup[]>('/courier/pickups');
  const [error, setError] = useState<string | null>(null);

  const finish = async (p: Pickup) => {
    setError(null);
    try {
      await api(`/courier/pickups/${p.id}/finish`, { body: {} });
      await pickups.reload();
    } catch (e) {
      setError(t(errorMessage(e)));
    }
  };

  return (
    <>
      <h1 className="text-h2">{t('Pickups')}</h1>
      <p className="mb-4 mt-1 text-body-sm text-text-muted">{t('At the merchant, scan every parcel label before it goes in your vehicle, then take them to the sorting facility.')}</p>
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {!pickups.data ? <Loading /> : pickups.data.length === 0 ? <Empty>{t('No pickups for you.')}</Empty> : (
        <div className="space-y-4">
          {pickups.data.map((p) => (
            <Card key={p.id} title={p.merchant.name} actions={<Badge tone={p.status === 'ASSIGNED' ? 'amber' : 'green'}>{p.status === 'ASSIGNED' ? t('To collect') : t('Take to the facility')}</Badge>}>
              <p className="flex gap-2 text-body-sm"><Icon name="store" size={18} className="text-text-muted" />{p.merchant.pickupAddress}</p>
              <p className="mt-1 text-caption text-text-muted">{shortDate(p.date)} · <span className="ltr-iso">{p.code}</span> · {t('About {n} parcels', { n: p.expectedCount })}{p.notes ? ` · ${p.notes}` : ''}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={`tel:${p.merchant.phone}`} className="btn-secondary min-h-11"><Icon name="support" size={18} />{t('Call')}</a>
                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.merchant.pickupAddress)}`} target="_blank" rel="noreferrer" className="btn-secondary min-h-11"><Icon name="route" size={18} />{t('Map')}</a>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
                <span className="text-body-sm">{t('Collected')}</span>
                <span className="tabular text-number-lg">{p.collected}</span>
              </div>
              {p.status === 'ASSIGNED' && (
                <div className="mt-3 space-y-3">
                  <ScanBox
                    size="md"
                    label={t('Scan parcel label')}
                    onScan={async (code) => {
                      const r = await api(`/courier/pickups/${p.id}/collect`, { body: { code } });
                      void pickups.reload();
                      return { big: String(p.collected + 1), text: t(r.message) };
                    }}
                  />
                  <Button className="w-full min-h-12" tone="accent" disabled={p.collected === 0} onClick={() => void finish(p)}>{t('Done, leaving the merchant')}</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
