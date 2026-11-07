import { canDo, SETTING_DEFINITIONS } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ViolationTypesEditor } from '@/components/hr/leave/ViolationTypesEditor';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { SettingsList } from '@/lib/dashboard-types';
import type { ViolationType } from '@/lib/leave-types';

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
      <h1 className="text-h2">{t('violationTypesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('violationTypesIntro')}</p>
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
