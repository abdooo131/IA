import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { RequestCard } from '@/components/finance/Approvals';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { FinanceRequestRow } from '@/lib/finance-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** One request waiting for a second person: approve, reject with a note, or withdraw your own. */
export default async function FinanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile, me, t, tf] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/finance_request/${id}`),
    getMyProfile(),
    getCurrentUser(),
    getTranslations('finance.approvals'),
    getTranslations('finance.merchants.errors'),
  ]);
  const previewError = typeof doc.data.previewError === 'string' ? doc.data.previewError : null;
  const request =
    doc.status === 'pending' && canDo(profile, 'accounting', 'use')
      ? (await apiGet<FinanceRequestRow[]>('/finance/requests?status=pending')).find(
          (r) => r.id === id,
        )
      : undefined;
  return (
    <DocumentPage
      doc={doc}
      actions={
        request ? (
          <ul>
            <RequestCard
              request={request}
              meId={me?.id ?? ''}
              canDecide={canDo(profile, 'accounting', 'manage')}
            />
          </ul>
        ) : undefined
      }
    >
      {doc.data.linesPreview && doc.lines && (
        <p className="text-caption text-text-muted">{t('linesPreview')}</p>
      )}
      {previewError && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-body-sm">
          {t('previewRefused', {
            reason: tf.has(previewError) ? tf(previewError) : previewError,
          })}
        </p>
      )}
    </DocumentPage>
  );
}
