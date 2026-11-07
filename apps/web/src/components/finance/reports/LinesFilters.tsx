'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { FilterOption } from './ReportFilterBar';

const field = 'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';

/**
 * The drill down's own filters (store, merchant, rider, entry kind): each change rewrites its
 * param in the address, keeping the list's state and the way back to the report.
 */
export function LinesFilters({
  stores,
  merchants,
  riders,
  kinds,
}: {
  stores: FilterOption[];
  merchants: FilterOption[];
  riders: FilterOption[];
  kinds: FilterOption[];
}) {
  const t = useTranslations('finance.drill');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    start(() => router.push(`${pathname}?${next}`, { scroll: false }));
  };
  const select = (key: string, label: string, all: string, options: FilterOption[], none?: string) => (
    <label className="text-caption">
      {label}
      <select value={params.get(key) ?? ''} onChange={(e) => set(key, e.target.value)} className={field}>
        <option value="">{all}</option>
        {none && <option value="none">{none}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div
      className={`mt-4 grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-4 ${pending ? 'opacity-70' : ''}`}
    >
      {select('store', t('store'), t('allStores'), stores, t('noStore'))}
      {select('merchant', t('merchant'), t('allMerchants'), merchants, t('noMerchant'))}
      {select('rider', t('rider'), t('allRiders'), riders)}
      {select('kind', t('kind'), t('allKinds'), kinds)}
    </div>
  );
}
