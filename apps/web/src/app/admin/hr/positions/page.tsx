import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { PositionsEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DepartmentRow, GradeRow, PositionRow } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/** HR configuration: HR view reads it, HR manage changes it (docs/HR.md). */
export default async function PositionsPage() {
  const [rows, departments, grades, profile, t] = await Promise.all([
    apiGet<PositionRow[]>('/hr/positions'),
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<GradeRow[]>('/hr/grades'),
    getMyProfile(),
    getTranslations('people'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('positionsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('positionsIntro')}</p>
      <PositionsEditor
        rows={rows}
        departments={departments}
        grades={grades}
        canManage={canDo(profile, 'hr', 'manage')}
      />
    </>
  );
}
