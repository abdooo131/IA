import { PAYMENT_DUE_KINDS, type PaymentDueKind } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { type PaymentsDueData, PaymentsDueGroups } from '@/components/finance/PaymentsDue';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Coming up and due: every known payment of the next 90 days, with a filter by kind. */
export default async function FinanceDuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const kind = one(sp.kind);
  const chosen = (PAYMENT_DUE_KINDS as readonly string[]).includes(kind)
    ? (kind as PaymentDueKind)
    : null;
  const query = new URLSearchParams({ days: '90', ...(chosen ? { kinds: chosen } : {}) });
  const [data, t] = await Promise.all([
    apiGet<PaymentsDueData>(`/finance/payments-due?${query.toString()}`),
    getTranslations('finance.due'),
  ]);
  const chip = (active: boolean) =>
    `inline-flex h-10 items-center rounded-pill border px-3 text-body-sm font-semibold ${
      active
        ? 'border-primary bg-selected-bg text-link'
        : 'border-line bg-surface text-text hover:bg-surface-raised'
    }`;
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {t('pageIntro', { until: isoToDayFirst(data.until) })}
      </p>
      <details className="mt-2 max-w-3xl text-body-sm">
        <summary className="cursor-pointer font-semibold text-link">{t('howCounted')}</summary>
        <p className="mt-1 text-text-muted">{t('method')}</p>
      </details>
      <nav aria-label={t('filterLabel')} className="mt-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link href="/finance/due" className={chip(chosen === null)}>
              {t('allKinds')}
            </Link>
          </li>
          {PAYMENT_DUE_KINDS.map((k) => (
            <li key={k}>
              <Link href={`/finance/due?kind=${k}`} className={chip(chosen === k)}>
                {t(`kinds.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-4">
        <PaymentsDueGroups data={data} />
      </div>
    </>
  );
}
