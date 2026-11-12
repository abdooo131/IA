import { addDays, cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { StatementView } from '@/components/finance/StatementView';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { Statement } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinanceStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : addDays(today, -29);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const query = new URLSearchParams({ from, to });
  const [statement, t] = await Promise.all([
    apiGet<Statement>(`/finance/statements/${id}?${query}`),
    getTranslations('finance.merchants'),
  ]);
  return (
    <>
      <BackLink href="/finance/merchants" />
      <h1 className="text-h2">
        {t('statement')}: {statement.merchant.name}
      </h1>
      <StatementView
        statement={statement}
        from={from}
        to={to}
        exportHref={`/api/finance/statements/${id}/export.csv?${query}`}
      />
    </>
  );
}
