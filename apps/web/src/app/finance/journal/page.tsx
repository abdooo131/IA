import { getTranslations } from 'next-intl/server';
import { InfoTip } from '@/components/odoo/InfoTip';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';

export const dynamic = 'force-dynamic';

/**
 * The journal: every entry the books hold, as a list view (search a voucher, an order or a
 * memo; filter by date and kind; group by kind or day). Each entry opens with its lines.
 * The accountant's CSV of every line stays under Export for the journal lines.
 */
export default async function FinanceJournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, tf] = await Promise.all([
    searchParams,
    getTranslations('finance.journal'),
    getTranslations('finance'),
  ]);
  return (
    <FinanceListPage
      id="journal"
      searchParams={params}
      title={
        <>
          {t('title')}
          <InfoTip term="journal" />
        </>
      }
      intro={t('intro')}
      toolbar={
        <a
          href="/api/finance/ledger/export.csv"
          className="flex h-11 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {tf('export')} · {t('linesCsv')}
        </a>
      }
    />
  );
}
