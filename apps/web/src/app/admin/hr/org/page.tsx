import { getTranslations } from 'next-intl/server';
import { OrgChart } from '@/components/hr/OrgChart';
import { apiGet } from '@/lib/api-server';
import type { OrgChartData } from '@/lib/hr-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/** The org chart, drawn from manager links (or grouped by department). */
export default async function OrgChartPage() {
  const [data, t] = await Promise.all([apiGet<OrgChartData>('/hr/org'), getTranslations('people')]);
  return (
    <>
      <HrPageHeader title={t('orgTitle')} intro={t('orgIntro')} />
      <div className="mt-4">
        <OrgChart data={data} fileHref="/admin/hr" />
      </div>
    </>
  );
}
