import { getTranslations } from 'next-intl/server';
import { ContractPanel, type ContractView } from '@/components/finance/Contracts';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** The merchant's own contract, read only. */
export default async function MerchantContractPage() {
  const [view, t] = await Promise.all([
    apiGet<ContractView>('/merchant/contract'),
    getTranslations('contracts'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <div className="mt-4 max-w-3xl">
        <ContractPanel view={view} canEdit={false} internal={false} />
      </div>
    </>
  );
}
