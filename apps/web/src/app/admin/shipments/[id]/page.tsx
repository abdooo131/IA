import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DocEntries, type DocEntryRow } from '@/components/odoo/DocEntries';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { ShipmentDetailView } from '@/components/shipment/ShipmentDetailView';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ShipmentDetail } from '@/lib/shipment-types';

export const dynamic = 'force-dynamic';

/**
 * One shipment in as a document page (UX phase C step 2): status bar, smart buttons
 * (merchant, store, lines, units received, the receiving fee entries for accounting), the
 * shipment's story, goods and scans, the entries it booked, and the chatter.
 */
export default async function AdminShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = `/admin/manifests/${encodeURIComponent(id)}`;
  const [detail, doc, profile, ta, ts] = await Promise.all([
    apiGet<ShipmentDetail>(api),
    apiGet<{ smart: DocSmartButton[]; entries: DocEntryRow[] }>(`${api}/document`),
    getMyProfile(),
    getTranslations('apps'),
    getTranslations('merchant.shipments.statuses'),
  ]);
  return (
    <DocumentFrame
      root={{ label: ta('names.inventory'), href: '/admin/stock' }}
      list={{ label: ta('pages.shipments'), href: '/admin/shipments' }}
      id={detail.id}
      number={detail.reference}
      title={detail.merchant.name}
      status={detail.status}
      statusLabel={ts(detail.status)}
      flow="shipment"
      smart={doc.smart}
      entityType="inbound_manifest"
      canWrite={canDo(profile, 'inventory', 'use')}
    >
      <ShipmentDetailView detail={detail} backHref="/admin/shipments" framed />
      <DocEntries entries={doc.entries} />
    </DocumentFrame>
  );
}
