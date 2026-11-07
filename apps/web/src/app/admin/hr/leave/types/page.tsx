import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { LeaveTypesEditor } from '@/components/hr/leave/LeaveTypesEditor';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeaveType } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** Leave types: HR manage edits them; the yearly days and accrual are HR settings. */
export default async function LeaveTypesPage() {
  const [rows, profile, t] = await Promise.all([
    apiGet<LeaveType[]>('/hr/leave/types'),
    getMyProfile(),
    getTranslations('hr3'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('typesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('typesIntro')}</p>
      <LeaveTypesEditor rows={rows} canManage={canDo(profile, 'hr', 'manage')} />
    </>
  );
}
