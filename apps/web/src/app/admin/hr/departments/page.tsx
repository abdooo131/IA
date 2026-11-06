import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { DepartmentsEditor } from '@/components/hr/HrConfig';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DepartmentRow, EmployeeRow } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/** HR configuration: HR view reads it, HR manage changes it (docs/HR.md). */
export default async function DepartmentsPage() {
  const [rows, people, stores, profile, t] = await Promise.all([
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<EmployeeRow[]>('/hr/employees?status=active'),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getMyProfile(),
    getTranslations('people'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('departmentsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('departmentsIntro')}</p>
      <DepartmentsEditor
        rows={rows}
        people={people}
        stores={stores}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
