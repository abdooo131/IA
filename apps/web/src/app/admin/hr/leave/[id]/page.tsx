import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { LeaveDetailView } from '@/components/hr/leave/LeaveDetailView';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { LeaveRequestDetail } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/**
 * One leave request as a document page (UX phase C step 4): breadcrumbs back to the list,
 * previous and next, the manager then HR status bar, smart buttons (the person's file, the
 * leave left, the note), its days, balance and decisions with HR's actions (unchanged), and
 * the chatter with its history.
 */
export default async function LeaveRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, profile, t, ta, tw, locale] = await Promise.all([
    apiGet<LeaveRequestDetail>(`/hr/leave/requests/${id}`),
    getMyProfile(),
    getTranslations('hr3'),
    getTranslations('apps'),
    getTranslations('workflow'),
    getLocale(),
  ]);
  const canUse = canDo(profile, 'hr', 'use');
  const name = (x: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn;
  const left = r.balance.line?.available ?? r.balance.annual?.available ?? null;
  const smart: DocSmartButton[] = [
    { key: 'employee', count: null, value: r.employee.code, href: `/admin/hr/${r.employee.id}` },
    {
      key: 'balance',
      count: null,
      value: left === null ? '–' : String(left),
      href: `/admin/hr/${r.employee.id}?tab=leave`,
    },
  ];
  if (r.hasDocument)
    smart.push({
      key: 'leaveDocument',
      count: 1,
      href: `/api/hr/leave/requests/${r.id}/document`,
    });
  return (
    <DocumentFrame
      root={{ label: ta('names.hr'), href: '/admin/hr/overview' }}
      list={{ label: t('requestsTitle'), href: '/admin/hr/leave' }}
      id={r.id}
      number={r.number}
      title={name(r.employee)}
      status={r.status}
      statusLabel={tw.has(`states.${r.status}`) ? tw(`states.${r.status}`) : r.status}
      flow="leave"
      smart={smart}
      entityType="leave_request"
      canWrite={canUse}
    >
      <LeaveDetailView
        request={r}
        mode="hr"
        canUse={canUse}
        documentPath={`/api/hr/leave/requests/${r.id}/document`}
      />
    </DocumentFrame>
  );
}
