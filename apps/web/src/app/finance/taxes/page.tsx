import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Taxes } from '@/components/finance/Payables';
import { VatView } from '@/components/finance/PeriodReports';
import { InfoTip } from '@/components/odoo/InfoTip';
import { apiGet } from '@/lib/api-server';
import type { BookAccount, TaxesOwed, VatReport, WhtReport } from '@/lib/finance-types';
import { ReturnsTab } from './ReturnsTab';

export const dynamic = 'force-dynamic';

const TABS = ['owed', 'vat', 'returns'] as const;
type Tab = (typeof TABS)[number];

/**
 * Taxes as one page with tabs (Accounting UX phase A): what we owe and pay (VAT, withholding,
 * salary tax and insurance), the VAT report by month, and the tax returns. The old addresses
 * /finance/vat and /finance/tax-returns open the matching tab.
 */
export default async function FinanceTaxesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    year?: string;
    quarter?: string;
    month?: string;
    taxYear?: string;
  }>;
}) {
  const q = await searchParams;
  const tab: Tab = TABS.find((x) => x === q.tab) ?? 'owed';
  const [t, tp] = await Promise.all([
    getTranslations('finance.taxesPage'),
    getTranslations('finance.payables'),
  ]);

  let body: React.ReactNode;
  if (tab === 'owed') {
    const query = new URLSearchParams();
    if (q.year && /^\d{4}$/.test(q.year)) query.set('year', q.year);
    if (q.quarter && /^[1-4]$/.test(q.quarter)) query.set('quarter', q.quarter);
    const [owed, report, accounts] = await Promise.all([
      apiGet<TaxesOwed>('/finance/taxes'),
      apiGet<WhtReport>(`/finance/taxes/withholding?${query.toString()}`),
      apiGet<BookAccount[]>('/finance/accounts'),
    ]);
    body = (
      <>
        <p className="mt-3 max-w-3xl text-body-sm text-text-muted">
          {tp('taxesIntro')}
          <InfoTip term="withholding" />
        </p>
        <Taxes owed={owed} report={report} accounts={accounts} />
      </>
    );
  } else if (tab === 'vat') {
    const report = await apiGet<VatReport>(
      `/finance/vat-report${q.year && /^\d{4}$/.test(q.year) ? `?year=${q.year}` : ''}`,
    );
    const tr = await getTranslations('finance.period');
    body = (
      <>
        <h2 className="mt-4 text-h3">{tr('vatTitle', { year: report.year })}</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{tr('vatIntro')}</p>
        <VatView report={report} />
      </>
    );
  } else {
    body = (
      <div className="mt-4">
        <ReturnsTab q={q} />
      </div>
    );
  }

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <nav
        aria-label={t('title')}
        className="mt-4 flex flex-wrap gap-1 border-b border-line print:hidden"
      >
        {TABS.map((x) => (
          <Link
            key={x}
            href={`/finance/taxes?tab=${x}`}
            aria-current={tab === x ? 'page' : undefined}
            className={`-mb-px flex h-11 items-center border-b-2 px-4 text-body-sm font-bold ${
              tab === x
                ? 'border-primary text-link'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t(`tabs.${x}`)}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}
