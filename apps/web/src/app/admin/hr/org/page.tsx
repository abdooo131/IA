import { getTranslations } from 'next-intl/server';
import { OrgChart } from '@/components/hr/OrgChart';
import { apiGet } from '@/lib/api-server';
import type { OrgChartData } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/** The org chart, drawn from manager links (or grouped by department). */
export default async function OrgChartPage() {
  const [data, t] = await Promise.all([apiGet<OrgChartData>('/hr/org'), getTranslations('people')]);
  return (
    <>
      <h1 className="text-h2">{t('orgTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted print:hidden">{t('orgIntro')}</p>
      <div className="mt-4">
        <OrgChart data={data} fileHref="/admin/hr" />
      </div>
    </>
  );
}
