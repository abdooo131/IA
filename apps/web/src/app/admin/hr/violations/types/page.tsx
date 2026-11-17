import { canDo, SETTING_DEFINITIONS } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ViolationTypesEditor } from '@/components/hr/leave/ViolationTypesEditor';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { SettingsList } from '@/lib/dashboard-types';
import type { ViolationType } from '@/lib/leave-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/** Violation types and their penalty ladders (HR manage edits; the period is an HR setting). */
export default async function ViolationTypesPage() {
  const [rows, settings, profile, t] = await Promise.all([
    apiGet<ViolationType[]>('/hr/violations/types'),
    apiGet<SettingsList>('/admin/settings'),
    getMyProfile(),
    getTranslations('hr3'),
  ]);
  const period = settings.settings.find((s) => s.key === 'hr.violation_period_days');
  return (
    <>
      <HrPageHeader title={t('violationTypesTitle')} intro={t('violationTypesIntro')} />
      <ViolationTypesEditor
        rows={rows}
        canManage={canDo(profile, 'hr', 'manage')}
        periodDays={Number(
          period
            ? (period.global ?? period.default)
            : SETTING_DEFINITIONS['hr.violation_period_days'].default,
        )}
      />
    </>
  );
}
