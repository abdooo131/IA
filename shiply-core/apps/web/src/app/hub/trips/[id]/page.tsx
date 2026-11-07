'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useHub } from '@/components/HubContext';
import { Alert, Button, Loading, Table, Td } from '@/components/ui';
import { dateTime, egp } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

interface Manifest {
  code: string;
  status: string;
  vehicle: string;
  driverName: string;
  departedAt: string | null;
  createdAt: string;
  backhaulOf: string | null;
  origin: { code: string; name: string };
  destination: { code: string; name: string };
  pallets: { code: string; sealNo: string; bags: string[] }[];
  bags: { code: string; parcels: number; pallet: string | null }[];
  parcels: { trackingNumber: string; codAmount: number; bag: string; merchant: { name: string } }[];
  totalParcels: number;
  totalCod: number;
}

/** The trip manifest (master waybill list) to print and hand to the driver. */
export default function ManifestPage() {
  const t = useT();
  const hub = useHub();
  const { id } = useParams<{ id: string }>();
  const m = useLoad<Manifest>(`/hubs/${hub.id}/trips/${id}/manifest`);
  if (!m.data) return m.error ? <Alert>{m.error}</Alert> : <Loading />;
  const d = m.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/hub/trips" className="text-body-sm font-bold text-link">← {t('Trips')}</Link>
        <Button tone="secondary" onClick={() => window.print()}>{t('Print')}</Button>
      </div>
      <article className="space-y-5 rounded-xl border border-line bg-surface p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-h3">{t('Trip manifest')}</p>
            <p className="ltr-iso text-h2">{d.code}</p>
            {d.backhaulOf && <p className="text-caption">{t('Back haul of')} <span className="ltr-iso">{d.backhaulOf}</span></p>}
          </div>
          <div className="text-body-sm">
            <p><span className="text-text-muted">{t('From')}</span> {d.origin.code} · {d.origin.name}</p>
            <p><span className="text-text-muted">{t('To')}</span> {d.destination.code} · {d.destination.name}</p>
            <p><span className="text-text-muted">{t('Vehicle')}</span> {d.vehicle || '—'} · {d.driverName || '—'}</p>
            <p><span className="text-text-muted">{t('Left')}</span> {d.departedAt ? dateTime(d.departedAt) : t('Not yet')}</p>
          </div>
        </header>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><p className="text-number-lg">{d.pallets.length}</p><p className="text-caption text-text-muted">{t('Pallets')}</p></div>
          <div><p className="text-number-lg">{d.bags.length}</p><p className="text-caption text-text-muted">{t('Bags')}</p></div>
          <div><p className="text-number-lg">{d.totalParcels}</p><p className="text-caption text-text-muted">{t('Parcels')} · {egp(d.totalCod)} COD</p></div>
        </div>
        {d.pallets.length > 0 && (
          <Table head={[t('Pallet'), t('Seal'), t('Bags')]}>
            {d.pallets.map((p) => <tr key={p.code}><Td><span className="ltr-iso font-bold">{p.code}</span></Td><Td><span className="ltr-iso">{p.sealNo}</span></Td><Td><span className="ltr-iso">{p.bags.join(', ')}</span></Td></tr>)}
          </Table>
        )}
        <Table head={[t('Parcel'), t('Bag'), t('Merchant'), 'COD']}>
          {d.parcels.map((p) => <tr key={p.trackingNumber}><Td><span className="ltr-iso">{p.trackingNumber}</span></Td><Td><span className="ltr-iso">{p.bag}</span></Td><Td>{p.merchant.name}</Td><Td>{egp(p.codAmount)}</Td></tr>)}
        </Table>
        <div className="grid grid-cols-2 gap-8 pt-8 text-body-sm">
          <p className="border-t border-line pt-2">{t('Handed over by (outbound)')}</p>
          <p className="border-t border-line pt-2">{t('Received by (driver)')}</p>
        </div>
      </article>
    </div>
  );
}
