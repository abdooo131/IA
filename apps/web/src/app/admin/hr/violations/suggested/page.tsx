import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { btnSecondary } from '@/components/hr/HrPage';
import { SuggestionsList } from '@/components/hr/leave/SuggestionsList';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { Suggestion } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/**
 * Suggested violations as a list view (UX phase C step 4): opens on those waiting; tick
 * several to confirm them onto each person's ladder with the suggested type, or dismiss them.
 * One suggestion can still be confirmed with another type below.
 */
export default async function SuggestedViolationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, profile, t, tl, ta] = await Promise.all([
    searchParams,
    getMyProfile(),
    getTranslations('hr3'),
    getTranslations('appLists.suggestions'),
    getTranslations('apps'),
  ]);
  const canUse = canDo(profile, 'hr', 'use');
  const open = canUse ? await apiGet<Suggestion[]>('/hr/violations/suggestions') : [];
  return (
    <>
      <AppListPage
        list="hr/suggestions"
        searchParams={params}
        title={t('suggestedTitle')}
        intro={tl('intro')}
        toolbar={
          <Link href="/admin/hr/violations" className={btnSecondary}>
            {ta('pages.violations')}
          </Link>
        }
      />
      {canUse && open.length > 0 && (
        <details className="mt-6 rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer text-h3">{t('suggestedOneByOne')}</summary>
          <SuggestionsList rows={open} canUse={canUse} />
        </details>
      )}
    </>
  );
}
