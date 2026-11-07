import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { type BankFile, BankFilePanel } from '@/components/finance/BankFilePanel';
import { PayoutsManager } from '@/components/finance/PayoutsManager';
import { apiGet } from '@/lib/api-server';
import type { PayoutRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinancePayoutsPage() {
  const [payouts, file, t] = await Promise.all([
    apiGet<PayoutRow[]>('/finance/payouts'),
    apiGet<BankFile>('/finance/payouts/bank-file'),
    getTranslations('finance.payouts'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <BankFilePanel file={file} />
      <PayoutsManager payouts={payouts} today={cairoDay(new Date())} />
    </>
  );
}
