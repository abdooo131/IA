import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { GradesEditor } from '@/components/hr/HrConfig';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { GradeRow } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/** HR configuration: HR view reads it, HR manage changes it (docs/HR.md). */
export default async function GradesPage() {
  const [rows, profile, t] = await Promise.all([
    apiGet<GradeRow[]>('/hr/grades'),
    getMyProfile(),
    getTranslations('people'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('gradesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('gradesIntro')}</p>
      <GradesEditor rows={rows} canManage={canDo(profile, 'hr', 'manage')} />
    </>
  );
}
