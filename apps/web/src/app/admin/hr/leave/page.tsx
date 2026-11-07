import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LeaveRequestForm } from '@/components/hr/leave/LeaveRequestForm';
import { LeaveRequestsTable } from '@/components/hr/leave/LeaveRequestsTable';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeaveRequest, LeaveType } from '@/lib/leave-types';
import { btnPrimary, HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

const TABS = ['pending', 'pending_hr', 'approved', 'all'] as const;

/** Leave requests (HR phase 3): what waits, what was approved, everything; HR asks for someone. */
export default async function LeaveRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const q = await searchParams;
  const tab = TABS.includes(q.status as (typeof TABS)[number])
    ? (q.status as (typeof TABS)[number])
    : 'pending';
  const status = tab === 'all' ? '' : tab;
  const profile = await getMyProfile();
  const canUse = canDo(profile, 'hr', 'use');
  const [rows, types, people, t] = await Promise.all([
    apiGet<LeaveRequest[]>(`/hr/leave/requests${status ? `?status=${status}` : ''}`),
    apiGet<LeaveType[]>('/hr/leave/types'),
    canUse
      ? apiGet<
          { id: string; code: string; nameEn: string; nameAr: string | null; status: string }[]
        >('/hr/employees')
      : Promise.resolve([]),
    getTranslations('hr3'),
  ]);
  const tabClass = (active: boolean) =>
    `flex h-10 items-center rounded-md px-3 text-body-sm font-bold ${
      active ? 'bg-selected-bg text-link' : 'border border-line bg-surface text-text'
    }`;
  return (
    <>
      <HrPageHeader
        title={t('requestsTitle')}
        intro={t('requestsIntro')}
        actions={
          canUse && (
            <a href="#ask" className={btnPrimary}>
              {t('askForSomeone')}
            </a>
          )
        }
      />
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('status')}>
        {TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/hr/leave?status=${s}`}
            aria-current={tab === s ? 'page' : undefined}
            className={tabClass(tab === s)}
          >
            {t(`tabs.${s}`)}
          </Link>
        ))}
      </nav>
      <LeaveRequestsTable rows={rows} hrefBase="/admin/hr/leave" />
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
