'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type { CustomerList, CustomerRow } from '@/lib/customer-types';

/**
 * Finds another profile of the same person (by name, mobile or email) and joins it into this
 * one. The other profile's phone and email stay as aliases so new orders still land here.
 */
export function MergeCustomerForm({ customerId }: { customerId: string }) {
  const t = useTranslations('customers');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (q.trim().length < 2) return;
    setError(null);
    const r = await apiGetClient<CustomerList>(
      `/admin/customers?q=${encodeURIComponent(q.trim())}`,
    );
    if (!r.ok) return setError(r.error);
    setFound(r.data.customers.filter((c) => c.id !== customerId));
  };

  const merge = async (other: CustomerRow) => {
    if (
      !window.confirm(t('mergeConfirm', { name: other.name || other.phone || other.email || '' }))
    )
      return;
    setBusy(true);
    const r = await apiSend('POST', `/admin/customers/${customerId}/merge`, { mergeId: other.id });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setFound(null);
    setQ('');
    router.refresh();
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('mergeTitle')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('mergeIntro')}</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchHint')}
          className="h-10 w-64 rounded-md border border-line bg-surface px-2 text-body-sm"
        />
        <button className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold">
          {t('find')}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic')}
        </p>
      )}
      {found && found.length === 0 && (
        <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
      )}
      {found && found.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {found.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-body-sm">
                {c.name || '–'}
                <span className="block text-caption text-text-muted ltr-iso">
                  {[c.phone, c.email].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void merge(c)}
                className="h-9 rounded-md bg-primary px-3 text-body-sm font-bold text-on-primary disabled:opacity-50"
              >
                {t('mergeHere')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
