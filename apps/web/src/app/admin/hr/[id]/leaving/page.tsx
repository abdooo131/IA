import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HrPageHeader } from '@/components/hr/HrPage';
import { LeavingWizard } from '@/components/hr/leaving/LeavingWizard';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeavingPreview } from '@/lib/hr-phase2';

export const dynamic = 'force-dynamic';

/** HR phase 2 (HR manage): someone leaves, step by step, from their file's Change status. */
export default async function LeavingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = cairoDay(new Date());
  const [profile, t] = await Promise.all([getMyProfile(), getTranslations('hr2')]);
  if (!canDo(profile, 'hr', 'manage')) notFound();
  const preview = await apiGet<LeavingPreview>(`/hr/employees/${id}/leaving?lastDay=${today}`);
  const name = preview.employee.nameEn;
  return (
    <>
      <HrPageHeader
        title={t('leaving.title', { name })}
        intro={t('leaving.intro')}
        back={{ href: `/admin/hr/${id}`, label: t('leaving.backFile') }}
      />
      {preview.blockers.alreadyLeft ? (
        <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-body-sm">
          {t('errors.employee_left')}
        </p>
      ) : (
        <LeavingWizard initial={preview} today={today} />
      )}
    </>
  );
}
