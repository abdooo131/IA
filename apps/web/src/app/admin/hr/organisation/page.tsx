import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { btnSecondary, HrPageHeader } from '@/components/hr/HrPage';
import { OrganisationSetup } from '@/components/hr/OrganisationSetup';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { ORG_TABS, type OrgTab } from '@/lib/hr-phase1';
import type { DepartmentRow, EmployeeRow, GradeRow, PositionRow } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/**
 * One organisation setup page (HR phase 1): departments as a tree with the selected one's
 * positions, every position, and the grades. HR view reads; HR manage changes. The old
 * addresses (/admin/hr/departments, /positions, /grades) open the right tab here.
 */
export default async function OrganisationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; department?: string }>;
}) {
  const q = await searchParams;
  const tab: OrgTab = ORG_TABS.includes(q.tab as OrgTab) ? (q.tab as OrgTab) : 'structure';
  const [departments, positions, grades, people, stores, profile, t] = await Promise.all([
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<PositionRow[]>('/hr/positions'),
    apiGet<GradeRow[]>('/hr/grades'),
    apiGet<EmployeeRow[]>('/hr/employees?status=active'),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getMyProfile(),
    getTranslations('hr1'),
  ]);
  return (
    <>
      <HrPageHeader
        title={t('org.title')}
        intro={t('org.intro')}
        actions={
          <Link href="/admin/hr/org" className={btnSecondary}>
            {t('org.openChart')}
          </Link>
        }
      />
      <OrganisationSetup
        tab={tab}
        selectedId={q.department ?? null}
        departments={departments}
        positions={positions}
        grades={grades}
        people={people}
        stores={stores}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
