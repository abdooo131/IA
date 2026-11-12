import { getTranslations } from 'next-intl/server';
import type { Person } from '@/lib/sales';

/** The month (and, for sales managers, the rep) a sales page shows. A plain GET form. */
export async function SalesMonthForm({
  month,
  people,
  ownerId,
}: {
  month: string;
  /** Sales managers only: pick one rep or everyone */
  people?: Person[];
  ownerId?: string | null;
}) {
  const t = await getTranslations('sales.numbers');
  const box = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
      <label className="text-caption">
        {t('month')}
        <input type="month" name="month" defaultValue={month} dir="ltr" className={box} />
      </label>
      {people && (
        <label className="text-caption">
          {t('rep')}
          <select name="ownerId" defaultValue={ownerId ?? ''} className={box}>
            <option value="">{t('everyone')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
      >
        {t('show')}
      </button>
    </form>
  );
}
