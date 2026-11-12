import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DocEntries, type DocEntryRow } from '@/components/odoo/DocEntries';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { ReturnDetailView } from '@/components/returns/ReturnDetailView';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ReturnDetail } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

/**
 * One return to the merchant as a document page (UX phase C step 2): status bar, smart
 * buttons (merchant, store, lines, units picked, the return fee entries for accounting), the
 * return with cancel as before, the entries it booked, and the chatter.
 */
export default async function AdminReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = `/admin/returns/${encodeURIComponent(id)}`;
  const [detail, doc, profile, ta, t] = await Promise.all([
    apiGet<ReturnDetail>(api),
    apiGet<{ smart: DocSmartButton[]; entries: DocEntryRow[] }>(`${api}/document`),
    getMyProfile(),
    getTranslations('apps'),
    getTranslations('returns'),
  ]);
  return (
    <DocumentFrame
      root={{ label: ta('names.inventory'), href: '/admin/stock' }}
      list={{ label: ta('pages.returnsToMerchants'), href: '/admin/returns' }}
      id={detail.id}
      number={detail.reference}
      title={detail.merchant.name}
      status={detail.status}
      statusLabel={t(`statuses.${detail.status}`)}
      flow="return"
      smart={doc.smart}
      entityType="merchant_return"
      canWrite={canDo(profile, 'inventory', 'use')}
    >
      <ReturnDetailView detail={detail} cancelPath={`${api}/cancel`} framed />
      <DocEntries entries={doc.entries} />
    </DocumentFrame>
  );
}
