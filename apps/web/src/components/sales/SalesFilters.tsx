import { CRM_SOURCES } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { Person } from '@/lib/sales';

const field = 'h-10 rounded-md border border-line-strong bg-surface px-2 text-body-sm';

export interface SalesFilterValues {
  ownerId?: string;
  source?: string;
  q?: string;
  closed?: string;
}

/**
 * Owner (managers only), source and search, sent as a plain form so the page works without
 * JavaScript; the board also offers to hide won and lost.
 */
export async function SalesFilters({
  action,
  values,
  people,
  withClosedToggle = false,
}: {
  action: string;
  values: SalesFilterValues;
  /** The sales people to filter by; empty for reps who only see their own deals */
  people: Person[];
  withClosedToggle?: boolean;
}) {
  const t = await getTranslations('sales');
  return (
    <form
      method="get"
      action={action}
      className="mt-4 flex flex-wrap items-end gap-2"
      aria-label={t('filters.label')}
    >
      {people.length > 0 && (
        <label className="flex flex-col text-caption">
          <span className="text-text-muted">{t('filters.owner')}</span>
          <select name="ownerId" defaultValue={values.ownerId ?? ''} className={field}>
            <option value="">{t('filters.everyone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col text-caption">
        <span className="text-text-muted">{t('filters.source')}</span>
        <select name="source" defaultValue={values.source ?? ''} className={field}>
          <option value="">{t('filters.allSources')}</option>
          {CRM_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`sources.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col text-caption sm:max-w-xs">
        <span className="text-text-muted">{t('filters.search')}</span>
        <input
          type="search"
          name="q"
          defaultValue={values.q ?? ''}
          placeholder={t('filters.searchHint')}
          className={`${field} w-full`}
        />
      </label>
      {withClosedToggle && (
        <label className="flex h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            name="closed"
            value="hide"
            defaultChecked={values.closed === 'hide'}
            className="h-4 w-4"
          />
          {t('filters.hideClosed')}
        </label>
      )}
      <button type="submit" className="btn-secondary">
        {t('filters.apply')}
      </button>
      <Link href={action} className="h-10 px-2 py-2 text-body-sm text-link">
        {t('filters.clear')}
      </Link>
    </form>
  );
}
