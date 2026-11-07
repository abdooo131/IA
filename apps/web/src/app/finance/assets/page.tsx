import { getTranslations } from 'next-intl/server';
import { PrepaidAndAssets } from '@/components/finance/Payables';
import { apiGet } from '@/lib/api-server';
import type { BookAccount, FixedAssetRow, PrepaymentRow, StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceAssetsPage() {
  const [prepayments, assets, accounts, stores, t] = await Promise.all([
    apiGet<PrepaymentRow[]>('/finance/prepayments'),
    apiGet<FixedAssetRow[]>('/finance/assets'),
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<StoreOption[]>('/finance/stores'),
    getTranslations('finance.payables'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('assetsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('assetsIntro')}</p>
      <PrepaidAndAssets
        prepayments={prepayments}
        assets={assets}
        accounts={accounts}
        stores={stores}
      />
    </>
  );
}
