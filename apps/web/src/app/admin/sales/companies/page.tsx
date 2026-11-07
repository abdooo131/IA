import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { SalesHeader } from '@/components/sales/SalesHeader';
import { apiGet } from '@/lib/api-server';
import type { CompanyRow, SalesMeta } from '@/lib/sales';

export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';

/** Sales > Companies: every brand we talk to (reps with own deals only: theirs). */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [rows, meta, t] = await Promise.all([
    apiGet<CompanyRow[]>(
      `/sales/companies${q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    ),
    apiGet<SalesMeta>('/sales/meta'),
    getTranslations('sales'),
  ]);
  return (
    <>
      <SalesHeader title={t('companies.title')} canAdd={meta.me.level !== 'view'} />
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col text-caption sm:max-w-sm">
          <span className="text-text-muted">{t('filters.search')}</span>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder={t('companies.searchHint')}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm"
          />
        </label>
        <button type="submit" className="btn-secondary">
          {t('filters.apply')}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">{t('companies.empty')}</p>
      ) : (
        <div className="mt-4 max-w-full overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[640px] text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('list.company')}</th>
                <th className={th}>{t('fields.source')}</th>
                <th className={th}>{t('list.owner')}</th>
                <th className={`${th} text-end`}>{t('companies.openDeals')}</th>
                <th className={`${th} text-end`}>{t('companies.won')}</th>
                <th className={th}>{t('fields.merchant')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className={td}>
                    <Link href={`/admin/sales/companies/${c.id}`} className="font-bold text-link">
                      {c.brandName}
                    </Link>
                    <span className="block text-caption text-text-muted">
                      {[c.city, c.category].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className={td}>{t(`sources.${c.source}`)}</td>
                  <td className={td}>{c.owner?.name ?? t('unassigned')}</td>
                  <td className={`${td} text-end`}>{c.openDeals}</td>
                  <td className={`${td} text-end`}>{c.wonDeals}</td>
                  <td className={td}>{c.merchant?.name ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
