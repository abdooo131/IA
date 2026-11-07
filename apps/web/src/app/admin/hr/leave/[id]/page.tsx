import { canDo } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LeaveDetailView } from '@/components/hr/leave/LeaveDetailView';
import { StatusBar } from '@/components/workflow/StatusBar';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeaveRequestDetail } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** One leave request: its days, the balance it draws on, who decided, and HR's actions. */
export default async function LeaveRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, profile, t, locale] = await Promise.all([
    apiGet<LeaveRequestDetail>(`/hr/leave/requests/${id}`),
    getMyProfile(),
    getTranslations('hr3'),
    getLocale(),
  ]);
  const canUse = canDo(profile, 'hr', 'use');
  const name = (x: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn;
  return (
    <>
      <Link href="/admin/hr/leave" className="text-body-sm text-link">
        {t('backToRequests')}
      </Link>
      <h1 className="mt-1 text-h2">
        <span className="ltr-iso">{r.number}</span> · {name(r.employee)}
      </h1>
      <StatusBar flow="leave" status={r.status} />
      <LeaveDetailView
        request={r}
        mode="hr"
        canUse={canUse}
        documentPath={`/api/hr/leave/requests/${r.id}/document`}
      />
      <RecordHistory entityType="leave_request" entityId={r.id} />
    </>
  );
}
