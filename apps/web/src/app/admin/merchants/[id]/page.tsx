import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ContractPanel, type ContractView } from '@/components/finance/Contracts';
import { type MerchantProfitDetail, ProfitSummaryCard } from '@/components/finance/MerchantProfit';
import { BackLink } from '@/components/store/BackLink';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/**
 * One merchant in the Merchants app: the contract (merchants manage edits it) and, for people
 * with Accounting, how profitable the merchant is this month.
 */
export default async function AdminMerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [view, profile, t] = await Promise.all([
    apiGet<ContractView>(`/admin/merchants/${id}/contract`),
    getMyProfile(),
    getTranslations('admin.merchants'),
  ]);
  const month = cairoDay(new Date()).slice(0, 7);
  const profit = canDo(profile, 'accounting', 'view')
    ? await apiGet<MerchantProfitDetail>(`/finance/merchant-profit/${id}?month=${month}`)
    : null;
  return (
    <>
      <BackLink href="/admin/merchants" />
      <h1 className="mt-2 text-h2">{view.merchant.name}</h1>
      <p className="text-body-sm text-text-muted">{t('open')}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ContractPanel view={view} canEdit={canDo(profile, 'merchants', 'manage')} internal />
        {profit && <ProfitSummaryCard row={profit} month={month} />}
      </div>
      <RecordHistory entityType="merchant_contract" entityId={id} />
    </>
  );
}
