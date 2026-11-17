import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { btnPrimary } from '@/components/hr/HrPage';
import { LeaveRequestForm } from '@/components/hr/leave/LeaveRequestForm';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { legacyListAddress } from '@/lib/legacy-list';
import type { LeaveType } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/**
 * Leave requests as a list view (UX phase C step 4): opens on what still waits; filters by
 * status, waiting for me and days; type, store, department and day values; grouping and the
 * days summed. Tick several to approve or refuse them at the step each waits for (the manager
 * step only by the manager, nobody their own). HR asks for someone below.
 */
export default async function LeaveRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The old tabs (?status=pending, pending_hr, approved, all) open the list state.
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  if (status === 'all') redirect('/admin/hr/leave?f=');
  const legacy = legacyListAddress('/admin/hr/leave', params, { status: { filter: true } });
  if (legacy) redirect(legacy);
  const profile = await getMyProfile();
  const canUse = canDo(profile, 'hr', 'use');
  const [types, people, t, tl] = await Promise.all([
    apiGet<LeaveType[]>('/hr/leave/types'),
    canUse
      ? apiGet<
          { id: string; code: string; nameEn: string; nameAr: string | null; status: string }[]
        >('/hr/employees')
      : Promise.resolve([]),
    getTranslations('hr3'),
    getTranslations('appLists.leave'),
  ]);
  return (
    <>
      <AppListPage
        list="hr/leave"
        searchParams={params}
        title={t('requestsTitle')}
        intro={tl('intro')}
        toolbar={
          canUse ? (
            <a href="#ask" className={btnPrimary}>
              {t('askForSomeone')}
            </a>
          ) : undefined
        }
      />
      {canUse && (
        <details
          id="ask"
          className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface p-4"
        >
          <summary className="cursor-pointer text-h3">{t('askForSomeone')}</summary>
          <p className="mt-1 text-caption text-text-muted">{t('askForSomeoneHint')}</p>
          <LeaveRequestForm
            types={types.filter((x) => x.isActive)}
            people={people.filter((p) => p.status !== 'left')}
          />
        </details>
      )}
    </>
  );
}
