import { canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type CostTagRow, CostTagsManager } from '@/components/finance/LoansFx';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { localized } from '@/lib/admin-types';

export const dynamic = 'force-dynamic';

/** The user's own cost tags (a campaign, a project): accounting manage opens and closes them. */
export default async function FinanceCostTagsPage() {
  const [tags, profile, t, locale] = await Promise.all([
    apiGet<CostTagRow[]>('/finance/cost-tags'),
    getMyProfile(),
    getTranslations('loansFx.tags'),
    getLocale(),
  ]);
  const canManage = canDo(profile, 'accounting', 'manage');
  return (
    <>
      <div className="flex max-w-2xl flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
        </div>
        <Link href="/finance/reports/tags" className="text-body-sm font-bold text-link">
          {t('report')}
        </Link>
      </div>
      {canManage ? (
        <CostTagsManager tags={tags} />
      ) : (
        <ul className="mt-4 max-w-2xl list-disc ps-6 text-body-sm">
          {tags.map((tag) => (
            <li key={tag.id}>{localized(tag, locale)}</li>
          ))}
        </ul>
      )}
    </>
  );
}
