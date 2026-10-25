import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Stat } from '@/components/admin/Stat';
import { StoreStatusChip } from '@/components/admin/StoreStatusChip';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCount } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const [stores, t, nav, locale] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getTranslations('admin.overview'),
    getTranslations('admin.nav'),
    getLocale(),
  ]);

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {stores.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-h3">{localized(s, locale)}</h2>
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">{s.code}</span> ·{' '}
                  {locale === 'ar' ? s.addressAr : s.addressEn}
                </p>
              </div>
            </div>
            <div className="mt-3">
              <StoreStatusChip
                openNow={s.openNow}
                atCapacity={s.atCapacity}
                nextOpenAt={s.nextOpenAt}
              />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Stat label={t('unitsOnHand')} value={formatCount(s.unitsOnHand)} />
              <Stat label={t('reserved')} value={formatCount(s.unitsReserved)} />
              <Stat label={t('skusInStock')} value={formatCount(s.skusInStock)} />
              <Stat
                label={t('ordersLastHour')}
                value={formatCount(s.ordersLastHour)}
                hint={t('ofCapacity', { capacity: s.capacityPerHour })}
              />
            </dl>
            <div className="mt-4 flex gap-4 text-body-sm font-bold">
              <Link className="text-link" href={`/admin/stock?store=${s.id}`}>
                {nav('stock')}
              </Link>
              <Link className="text-link" href={`/admin/zones?store=${s.id}`}>
                {t('zones')} (<span className="ltr-iso">{s.zoneCount}</span>)
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
