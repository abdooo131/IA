import { ShipmentDetailView } from '@/components/shipment/ShipmentDetailView';
import { apiGet } from '@/lib/api-server';
import type { ShipmentDetail } from '@/lib/shipment-types';

export const dynamic = 'force-dynamic';

export default async function MerchantShipmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await apiGet<ShipmentDetail>(`/merchant/manifests/${encodeURIComponent(id)}`);
  return <ShipmentDetailView detail={detail} backHref="/merchant" />;
}
