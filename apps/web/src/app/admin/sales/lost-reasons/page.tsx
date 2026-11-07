import { getTranslations } from 'next-intl/server';
import { LostReasonsManager } from '@/components/sales/LostReasonsManager';
import { apiGet } from '@/lib/api-server';
import type { LostReason } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/** Sales > Configuration > Lost reasons (sales manage). */
export default async function LostReasonsPage() {
  const [reasons, t] = await Promise.all([
    apiGet<LostReason[]>('/sales/lost-reasons'),
    getTranslations('sales'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('lostReasons.title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('lostReasons.intro')}</p>
      <LostReasonsManager reasons={reasons} />
    </>
  );
}
