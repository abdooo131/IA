import { getLocale, getTranslations } from 'next-intl/server';
import { DataTable } from '@/components/data/DataTable';
import { StatCard } from '@/components/StatCard';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { DistrictDemand } from '@/lib/customer-types';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Where the customers live against our zones: the districts worth a new dark store. */
export default async function CustomerPlacesPage() {
  const [d, t, locale] = await Promise.all([
    apiGet<DistrictDemand>('/admin/customers/places'),
    getTranslations('customers'),
    getLocale(),
  ]);
  const name = (en: string | null, ar: string | null) => (locale === 'ar' ? ar || en : en) ?? '';
  const outside = d.districts.filter((x) => x.coveredPct < 50);
  const row = (x: DistrictDemand['districts'][number]) => [
    <span key={x.id}>
      {name(x.nameEn, x.nameAr)}
      <span className="block text-caption text-text-muted">
        {name(x.governorateEn, x.governorateAr)}
      </span>
    </span>,
    x.customers,
    x.buyers,
    x.orders,
    formatEgp(x.spendPiastres),
    `${x.coveredPct}%`,
  ];
  const headers = [
    t('district'),
    t('customers'),
    t('buyers12'),
    t('orders12'),
    t('spend12'),
    t('covered'),
  ];
  return (
    <>
      <BackLink href="/admin/customers" />
      <h1 className="mt-2 text-h2">{t('placesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('placesIntro')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard
          label={t('placed')}
          value={String(d.placed)}
          hint={t('unplaced', { count: d.unplaced })}
        />
        <StatCard
          label={t('outsideSpend')}
          value={formatEgp(d.spendOutsidePiastres)}
          hint={t('outsideHint')}
        />
        <StatCard label={t('outsideDistricts')} value={String(outside.length)} />
      </div>
      <div className="mt-6 grid gap-4">
        <DataTable
          title={t('openNext')}
          empty={t('noPlaces')}
          headers={headers}
          rows={outside.map(row)}
        />
        <DataTable
          title={t('allDistricts')}
          empty={t('noPlaces')}
          headers={headers}
          rows={d.districts.map(row)}
        />
      </div>
    </>
  );
}
