import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { btnPrimary, HrPageHeader } from '@/components/hr/HrPage';
import { HireWizard } from '@/components/hr/hire/HireWizard';
import { apiGet } from '@/lib/api-server';
import type { HireDraft } from '@/lib/hr-phase2';
import { loadHireWizard, pickStep } from '../load';

export const dynamic = 'force-dynamic';

/** HR phase 2: a saved new hire draft, opened at its step (or the one in the address). */
export default async function HireDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { draftId } = await params;
  const asked = (await searchParams).step;
  const [w, draft, t] = await Promise.all([
    loadHireWizard(),
    apiGet<HireDraft>(`/hr/hire-drafts/${draftId}`),
    getTranslations('hr2'),
  ]);
  if (!w.canUse) notFound();
  const header = (
    <HrPageHeader
      title={
        draft.data.person.nameEn ? t('titleFor', { name: draft.data.person.nameEn }) : t('title')
      }
      intro={t('intro')}
      back={{ href: '/admin/hr/overview', label: t('backHome') }}
    />
  );
  if (draft.status !== 'open')
    return (
      <>
        {header}
        <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-body-sm">
          {draft.status === 'done' ? t('draftDone') : t('draftDiscarded')}
        </p>
        {draft.employeeId && (
          <Link href={`/admin/hr/${draft.employeeId}`} className={`${btnPrimary} mt-3`}>
            {t('done.openFile')}
          </Link>
        )}
      </>
    );
  return (
    <>
      {header}
      <HireWizard
        draft={draft}
        initialStep={pickStep(asked, draft.step)}
        lookups={w.lookups}
        grant={w.grant}
        probationMonths={w.probationMonths}
        today={w.today}
      />
    </>
  );
}
