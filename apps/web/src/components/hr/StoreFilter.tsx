'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Picks the store a page shows (kept in ?store=, the other query values stay). `all` is the
 * label of the empty choice (every store the person covers), or null when a store is needed.
 */
export function StoreFilter({
  stores,
  value,
  all,
  extra = [],
}: {
  stores: { id: string; label: string }[];
  value: string;
  all: string | null;
  extra?: { id: string; label: string }[];
}) {
  const t = useTranslations('attendance');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="mt-4 block max-w-xs text-caption">
      {t('store')}
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('store', e.target.value);
          else next.delete('store');
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text"
      >
        {all !== null && <option value="">{all}</option>}
        {[...stores, ...extra].map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
