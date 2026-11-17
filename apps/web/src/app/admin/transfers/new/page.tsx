import { getTranslations } from 'next-intl/server';
import { NewTransferForm } from '@/components/transfers/NewTransferForm';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function NewTransferPage() {
  const [stores, t] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getTranslations('transfers'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('new')}</h1>
      <NewTransferForm stores={stores.filter((s) => s.isActive)} />
    </>
  );
}
