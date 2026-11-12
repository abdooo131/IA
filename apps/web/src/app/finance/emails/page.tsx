import { getTranslations } from 'next-intl/server';
import { EmailOutbox } from '@/components/finance/EmailOutbox';
import { apiGet } from '@/lib/api-server';
import type { EmailOutboxPage } from '@/lib/purchasing-types';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'sent', 'failed'] as const;

export default async function FinanceEmailsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const q = await searchParams;
  const status = STATUSES.find((s) => s === q.status) ?? '';
  const [page, t] = await Promise.all([
    apiGet<EmailOutboxPage>(`/finance/emails${status ? `?status=${status}` : ''}`),
    getTranslations('purchasing.emails'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <EmailOutbox page={page} status={status} />
    </>
  );
}
