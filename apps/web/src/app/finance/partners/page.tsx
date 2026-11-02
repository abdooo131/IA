import { getTranslations } from 'next-intl/server';
import { PartnerList } from '@/components/finance/Partners';
import { apiGet } from '@/lib/api-server';
import type { MerchantTax, PartnerRow, SupplierRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function PartnersPage() {
  const [partners, suppliers, merchants, t] = await Promise.all([
    apiGet<PartnerRow[]>('/finance/partners'),
    apiGet<SupplierRow[]>('/finance/suppliers'),
    apiGet<MerchantTax[]>('/finance/merchants-tax'),
    getTranslations('finance.partners'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <PartnerList partners={partners} suppliers={suppliers} merchants={merchants} />
    </>
  );
}
