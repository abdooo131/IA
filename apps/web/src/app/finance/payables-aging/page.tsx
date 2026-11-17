import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { AgingFilters, PayablesAgingView } from '@/components/finance/Aging';
import type { PayablesAging } from '@/lib/aging-types';
import { apiGet, apiTry } from '@/lib/api-server';
import type { StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** What we owe suppliers, by age: open bills by their due day, as of a Cairo day. */
export default async function FinancePayablesAgingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const day = one(sp.day) || cairoDay(new Date());
  const q = one(sp.q);
  const store = one(sp.store);
  const query = new URLSearchParams({
    day,
    ...(q ? { q } : {}),
    ...(store ? { store } : {}),
  }).toString();
  const [report, stores, locale, t] = await Promise.all([
    apiGet<PayablesAging>(`/finance/aging/payables?${query}`),
    apiTry<StoreOption[]>('/finance/stores'),
    getLocale(),
    getTranslations('finance.aging'),
  ]);
  const options = (stores ?? []).map((s) => ({
    id: s.id,
    label: `${locale === 'ar' ? s.nameAr : s.nameEn} (${s.code})`,
  }));
  return (
    <>
      <h1 className="text-h2">{t('payablesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('payablesIntro')}</p>
      <details className="mt-2 max-w-3xl text-body-sm">
        <summary className="cursor-pointer font-semibold text-link">{t('howCounted')}</summary>
        <p className="mt-1 text-text-muted">{t('payablesMethod')}</p>
      </details>
      <AgingFilters kind="payables" day={report.asOf} q={q} store={store} stores={options} />
      <PayablesAgingView
        report={report}
        query={query}
        stores={Object.fromEntries(options.map((o) => [o.id, o.label]))}
      />
    </>
  );
}
