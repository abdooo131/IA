import { canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ViolationDetailView } from '@/components/hr/leave/ViolationDetailView';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { StatusBar } from '@/components/workflow/StatusBar';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ViolationDetail } from '@/lib/leave-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** One violation with its ladder, appeal and decision. */
export default async function ViolationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [v, profile, user, t, locale] = await Promise.all([
    apiGet<ViolationDetail>(`/hr/violations/${id}`),
    getMyProfile(),
    getCurrentUser(),
    getTranslations('hr3'),
    getLocale(),
  ]);
  const name = locale === 'ar' ? v.employee.nameAr || v.employee.nameEn : v.employee.nameEn;
  return (
    <>
      <Link href="/admin/hr/violations" className="text-body-sm text-link">
        {t('backToViolations')}
      </Link>
      <h1 className="mt-1 text-h2">
        <span className="ltr-iso">{v.number}</span> · {name}
      </h1>
      <StatusBar flow="violation" status={v.status} />
      <ViolationDetailView
        v={v}
        canUse={canDo(profile, 'hr', 'use')}
        canManage={canDo(profile, 'hr', 'manage')}
        meId={user?.id ?? null}
        evidencePath={`/api/hr/violations/${v.id}/evidence`}
      />
      <RecordHistory entityType="violation" entityId={v.id} />
    </>
  );
}
