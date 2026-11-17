import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HrPageHeader } from '@/components/hr/HrPage';
import { HireWizard } from '@/components/hr/hire/HireWizard';
import { loadHireWizard } from './load';

export const dynamic = 'force-dynamic';

/** HR phase 2: a new hire, step by step (the first Next saves a draft to come back to). */
export default async function NewHirePage() {
  const [w, t] = await Promise.all([loadHireWizard(), getTranslations('hr2')]);
  if (!w.canUse) notFound();
  return (
    <>
      <HrPageHeader
        title={t('title')}
        intro={t('intro')}
        back={{ href: '/admin/hr/overview', label: t('backHome') }}
      />
      <HireWizard
        draft={null}
        initialStep="person"
        lookups={w.lookups}
        grant={w.grant}
        probationMonths={w.probationMonths}
        today={w.today}
      />
    </>
  );
}
