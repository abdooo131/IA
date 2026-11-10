import { getTranslations } from 'next-intl/server';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { MyClaimsView } from '@/components/hr/pay/MyClaimsView';
import { apiGet } from '@/lib/api-server';
import type { MyExpenseClaims } from '@/lib/my-pay-types';

export const dynamic = 'force-dynamic';

/** My expense claims: claim back a work cost paid from my own pocket, and follow each claim. */
export default async function MyClaimsPage() {
  const [data, t] = await Promise.all([
    apiGet<MyExpenseClaims>('/me/expense-claims'),
    getTranslations('myPay'),
  ]);
  return (
    <MyHrFrame current="/my-file/claims" title={t('claimsTitle')} intro={t('claimsIntro')}>
      <MyClaimsView data={data} />
    </MyHrFrame>
  );
}
