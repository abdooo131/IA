import { addDays, cairoDay, LEDGER_KINDS } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { JournalList } from '@/components/finance/JournalList';
import { apiGet } from '@/lib/api-server';
import type { JournalPage } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinanceJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kind?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : addDays(today, -6);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const query = new URLSearchParams({ from, to });
  if (q.kind) query.set('kind', q.kind);
  const [first, t, tf] = await Promise.all([
    apiGet<JournalPage>(`/finance/ledger?${query}`),
    getTranslations('finance.journal'),
    getTranslations('finance'),
  ]);
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('intro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {tf('from')}
          <input type="date" name="from" defaultValue={from} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <input type="date" name="to" defaultValue={to} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {t('kind')}
          <select name="kind" defaultValue={q.kind ?? ''} className={field}>
            <option value="">{t('allKinds')}</option>
            {LEDGER_KINDS.map((k) => (
              <option key={k} value={k}>
                {tf(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
        <a
          href={`/api/finance/ledger/export.csv?${new URLSearchParams({ from, to })}`}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {tf('export')}
        </a>
      </form>
      <JournalList key={query.toString()} first={first} query={query.toString()} />
    </>
  );
}
