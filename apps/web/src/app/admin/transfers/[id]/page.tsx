import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { TransferAdminView } from '@/components/transfers/TransferAdminView';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { TransferDetail } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

/**
 * One transfer as a document page (UX phase C step 2): status bar, smart buttons (sender,
 * receiver, final destination, the legs before and after, lines, units asked, sent and
 * received), the route and lines with approve and cancel as before, and the chatter.
 */
export default async function AdminTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = `/admin/transfers/${encodeURIComponent(id)}`;
  const [detail, doc, profile, ta, t] = await Promise.all([
    apiGet<TransferDetail>(api),
    apiGet<{ smart: DocSmartButton[] }>(`${api}/document`),
    getMyProfile(),
    getTranslations('apps'),
    getTranslations('transfers'),
  ]);
  return (
    <DocumentFrame
      root={{ label: ta('names.inventory'), href: '/admin/stock' }}
      list={{ label: ta('pages.transfers'), href: '/admin/transfers' }}
      id={detail.id}
      number={detail.reference}
      title={detail.origin === 'refill' ? t('auto') : undefined}
      status={detail.status}
      statusLabel={t(`statuses.${detail.status}`)}
      flow="transfer"
      smart={doc.smart}
      entityType="transfer"
      canWrite={canDo(profile, 'inventory', 'use')}
    >
      <TransferAdminView detail={detail} framed />
    </DocumentFrame>
  );
}
