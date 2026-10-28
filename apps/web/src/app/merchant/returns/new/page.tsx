import { getTranslations } from 'next-intl/server';
import { NewReturnForm } from '@/components/returns/NewReturnForm';
import { apiGet } from '@/lib/api-server';
import type { StoreRef } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function NewReturnPage() {
  const [stores, t] = await Promise.all([
    apiGet<StoreRef[]>('/merchant/locations'),
    getTranslations('returns'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('new')}</h1>
      <NewReturnForm stores={stores} />
    </>
  );
}
