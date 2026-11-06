import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ShiftsManager } from '@/components/hr/ShiftsManager';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ShiftRow } from '@/lib/attendance-types';

export const dynamic = 'force-dynamic';

/** Shift templates the roster is built from (HR manage changes them). */
export default async function ShiftsPage() {
  const [shifts, profile, t] = await Promise.all([
    apiGet<ShiftRow[]>('/hr/shifts'),
    getMyProfile(),
    getTranslations('attendance'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('shiftsTitle')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('shiftsIntro')}</p>
      <ShiftsManager shifts={shifts} canEdit={canDo(profile, 'hr', 'manage')} />
    </>
  );
}
