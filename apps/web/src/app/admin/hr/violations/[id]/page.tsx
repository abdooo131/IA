import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { ViolationDetailView } from '@/components/hr/leave/ViolationDetailView';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ViolationDetail } from '@/lib/leave-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/**
 * One violation as a document page (UX phase C step 4): breadcrumbs, previous and next, the
 * recorded, appealed, final status bar, smart buttons (the person's file, the same type
 * before, the evidence), its ladder, appeal and decision (unchanged) and the chatter.
 */
export default async function ViolationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [v, profile, user, t, ta, tw, locale] = await Promise.all([
    apiGet<ViolationDetail>(`/hr/violations/${id}`),
    getMyProfile(),
    getCurrentUser(),
    getTranslations('hr3'),
    getTranslations('apps'),
    getTranslations('workflow'),
    getLocale(),
  ]);
  const name = locale === 'ar' ? v.employee.nameAr || v.employee.nameEn : v.employee.nameEn;
  const smart: DocSmartButton[] = [
    { key: 'employee', count: null, value: v.employee.code, href: `/admin/hr/${v.employee.id}` },
    {
      key: 'ladder',
      count: v.others.length,
      href: `/admin/hr/violations?f=&q=${encodeURIComponent(v.employee.code)}`,
    },
  ];
  if (v.hasEvidence)
    smart.push({ key: 'evidence', count: 1, href: `/api/hr/violations/${v.id}/evidence` });
  return (
    <DocumentFrame
      root={{ label: ta('names.hr'), href: '/admin/hr/overview' }}
      list={{ label: t('violationsTitle'), href: '/admin/hr/violations' }}
      id={v.id}
      number={v.number}
      title={name}
      status={v.status}
      statusLabel={tw.has(`states.${v.status}`) ? tw(`states.${v.status}`) : v.status}
      flow="violation"
      smart={smart}
      entityType="violation"
      canWrite={canDo(profile, 'hr', 'use')}
    >
      <ViolationDetailView
        v={v}
        canUse={canDo(profile, 'hr', 'use')}
        canManage={canDo(profile, 'hr', 'manage')}
        meId={user?.id ?? null}
        evidencePath={`/api/hr/violations/${v.id}/evidence`}
      />
    </DocumentFrame>
  );
}
