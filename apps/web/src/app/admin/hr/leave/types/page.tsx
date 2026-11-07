import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { LeaveTypesEditor } from '@/components/hr/leave/LeaveTypesEditor';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeaveType } from '@/lib/leave-types';
import { HrPageHeader } from '@/components/hr/HrPage';

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
      <HrPageHeader title={t('typesTitle')} intro={t('typesIntro')} />
      <LeaveTypesEditor rows={rows} canManage={canDo(profile, 'hr', 'manage')} />
    </>
  );
}
