import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { StatementView } from '@/components/finance/StatementView';
import { apiGet } from '@/lib/api-server';
import type { PayoutSchedule, Statement } from '@/lib/finance-types';
import { formatCairoDateTime, formatCutoffDay } from '@/lib/format';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Wallet {
  owedPiastres: number;
  payoutSchedule: PayoutSchedule;
  payouts: {
    id: string;
    cutoffAt: string;
    amountPiastres: number;
    status: 'draft' | 'paid';
    reference: string | null;
    paidAt: string | null;
  }[];
}

export default async function MerchantWalletPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : addDays(today, -29);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const query = new URLSearchParams({ from, to });
  const [wallet, statement, t, tf, locale] = await Promise.all([
    apiGet<Wallet>('/merchant/finance'),
    apiGet<Statement>(`/merchant/finance/statement?${query}`),
    getTranslations('merchantFinance'),
    getTranslations('finance'),
    getLocale(),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <section className="mt-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
        <p className="text-caption text-text-muted">
          {wallet.owedPiastres < 0 ? t('owes') : t('owed')}
        </p>
        <p className="text-h2">
          <Amount piastres={Math.abs(wallet.owedPiastres)} strong /> {tf('egp')}
        </p>
        <p className="mt-1 text-body-sm text-text-muted">
          {t('schedule', { schedule: tf(`schedules.${wallet.payoutSchedule}`) })}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('payouts')}</h2>
        {wallet.payouts.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noPayouts')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {wallet.payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-body-sm"
              >
                <span>
                  <span className="font-bold">
                    {p.status === 'paid' ? t('paid') : t('waiting')}
                  </span>
                  <span className="ltr-iso block text-caption text-text-muted">
                    {p.paidAt
                      ? formatCairoDateTime(p.paidAt, locale)
                      : formatCutoffDay(p.cutoffAt, locale)}
                  </span>
                  {p.reference && (
                    <span className="ltr-iso block text-caption text-text-muted">
                      {t('reference', { reference: p.reference })}
                    </span>
                  )}
                </span>
                <span className="text-h3">
                  <Amount piastres={p.amountPiastres} /> {tf('egp')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('statement')}</h2>
        <StatementView
          statement={statement}
          from={from}
          to={to}
          exportHref={`/api/merchant/finance/statement/export.csv?${query}`}
        />
      </section>
    </>
  );
}
