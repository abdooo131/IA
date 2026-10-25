import { getTranslations } from 'next-intl/server';
import { type AuditPage, AuditList } from '@/components/admin/AuditList';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

const ENTITIES = [
  'order',
  'sku',
  'stock_level',
  'inbound_manifest',
  'stock_count',
  'user',
  'merchant',
  'setting',
  'dark_store',
  'zone',
  'alert',
] as const;

type Filters = {
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
};

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  const [first, t] = await Promise.all([
    apiGet<AuditPage>(`/admin/audit?${query}`),
    getTranslations('admin.audit'),
  ]);
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {t('entity')}
          <select name="entityType" defaultValue={filters.entityType ?? ''} className={field}>
            <option value="">{t('allEntities')}</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {t(`entities.${e}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          {t('action')}
          <input
            name="action"
            defaultValue={filters.action ?? ''}
            dir="ltr"
            placeholder="order."
            className={`${field} w-36`}
          />
        </label>
        <label className="text-caption">
          {t('from')}
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ''}
            dir="ltr"
            className={field}
          />
        </label>
        <label className="text-caption">
          {t('to')}
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ''}
            dir="ltr"
            className={field}
          />
        </label>
        {filters.entityId && <input type="hidden" name="entityId" value={filters.entityId} />}
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('apply')}
        </button>
      </form>
      <AuditList key={query.toString()} first={first} query={query.toString()} />
    </>
  );
}
