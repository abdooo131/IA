import { ReturnDetailView } from '@/components/returns/ReturnDetailView';
import { apiGet } from '@/lib/api-server';
import type { ReturnDetail } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function AdminReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await apiGet<ReturnDetail>(`/admin/returns/${id}`);
  return <ReturnDetailView detail={detail} cancelPath={`/admin/returns/${id}/cancel`} />;
}
