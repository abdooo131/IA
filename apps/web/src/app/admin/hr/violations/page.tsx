import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { btnPrimary, btnSecondary } from '@/components/hr/HrPage';
import { RecordViolationForm } from '@/components/hr/leave/RecordViolationForm';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { ViolationType } from '@/lib/leave-types';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Violations as a list view (UX phase C step 4): status, penalty, employment, the deductions
 * to tell an outsourcing company and days as filters; type, store and days as values; grouped
 * by status, type, person, store, penalty or month. HR use records one below; the suggestions
 * of the attendance close have their own list.
 */
export default async function ViolationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The old tabs (?status=appealed, final, supplier) open the list state.
  const legacy = legacyListAddress(
    '/admin/hr/violations',
    { ...params, status: params.status === 'supplier' ? 'for_supplier' : params.status },
    { status: { filter: true } },
  );
  if (legacy) redirect(legacy);
  const profile = await getMyProfile();
  const canUse = canDo(profile, 'hr', 'use');
  const [types, people, badges, t, tl, ta] = await Promise.all([
    apiGet<ViolationType[]>('/hr/violations/types'),
    canUse
      ? apiGet<
          { id: string; code: string; nameEn: string; nameAr: string | null; status: string }[]
        >('/hr/employees')
      : Promise.resolve([]),
    apiTry<{ suggested: number }>('/me/hr-badges'),
    getTranslations('hr3'),
    getTranslations('appLists.violations'),
    getTranslations('apps'),
  ]);
  const suggested = badges?.suggested ?? 0;
  return (
    <>
      <AppListPage
        list="hr/violations"
        searchParams={params}
        title={t('violationsTitle')}
        intro={tl('intro')}
        toolbar={
          <>
            <Link href="/admin/hr/violations/suggested" className={btnSecondary}>
              {ta('pages.suggestedViolations')}
              {suggested > 0 && <span className="ltr-iso ms-1">({suggested})</span>}
            </Link>
            {canUse && (
              <a href="#record" className={btnPrimary}>
                {t('recordViolation')}
              </a>
            )}
          </>
        }
      />
      {canUse && (
        <details
          id="record"
          className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface p-4"
        >
          <summary className="cursor-pointer text-h3">{t('recordViolation')}</summary>
          <RecordViolationForm
            types={types.filter((x) => x.isActive)}
            people={people.filter((p) => p.status !== 'left')}
            today={cairoDay(new Date())}
          />
        </details>
      )}
    </>
  );
}
