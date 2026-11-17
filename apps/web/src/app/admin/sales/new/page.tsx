import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NewDealForm } from '@/components/sales/NewDealForm';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { CompanyDetail, SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** Sales: add a lead by hand (a new company, or a new deal for one we have). */
export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const { companyId } = await searchParams;
  const [meta, t] = await Promise.all([apiGet<SalesMeta>('/sales/meta'), getTranslations('sales')]);
  if (meta.me.level === 'view' || meta.me.level === 'none') notFound();
  const company = companyId ? await apiGet<CompanyDetail>(`/sales/companies/${companyId}`) : null;
  return (
    <>
      <BackLink href={company ? `/admin/sales/companies/${company.id}` : '/admin/sales/leads'} />
      <h1 className="mt-2 text-h2">{company ? t('companies.newDeal') : t('newDeal.title')}</h1>
      <NewDealForm
        company={company ? { id: company.id, brandName: company.brandName } : null}
        people={meta.people}
        manager={meta.me.level === 'manage'}
      />
    </>
  );
}
