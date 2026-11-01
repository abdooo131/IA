import { getTranslations } from 'next-intl/server';
import { CompanyTax } from '@/components/finance/Invoices';
import { apiGet } from '@/lib/api-server';
import type { CompanyProfile, EtaReadiness, MerchantTax } from '@/lib/finance-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function FinanceCompanyPage() {
  const [profile, readiness, merchants, me, t] = await Promise.all([
    apiGet<CompanyProfile>('/finance/company-profile'),
    apiGet<EtaReadiness>('/finance/eta/readiness'),
    apiGet<MerchantTax[]>('/finance/merchants-tax'),
    getCurrentUser(),
    getTranslations('finance.invoices'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('companyTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('companyIntro')}</p>
      <CompanyTax
        profile={profile}
        feeKinds={readiness.feeKinds}
        merchants={merchants}
        isAdmin={me?.role === 'admin'}
      />
    </>
  );
}
