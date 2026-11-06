import { getTranslations } from 'next-intl/server';
import { Payroll } from '@/components/finance/Payroll';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount, StaffPayRow } from '@/lib/finance-types';
import { canDo } from '@shiplynow/shared';

export const dynamic = 'force-dynamic';

export default async function FinancePayrollPage() {
  const [staff, accounts, me, t] = await Promise.all([
    apiGet<StaffPayRow[]>('/finance/staff-pay'),
    apiGet<BookAccount[]>('/finance/money-accounts'),
    getMyProfile(),
    getTranslations('finance.payroll'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <Payroll staff={staff} money={accounts} hrLink={canDo(me, 'hr', 'view')} />
    </>
  );
}
