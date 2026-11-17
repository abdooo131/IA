import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { AgingFilters, ReceivablesAgingView } from '@/components/finance/Aging';
import { InfoTip } from '@/components/odoo/InfoTip';
import type { ReceivablesAging } from '@/lib/aging-types';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Who owes us, by age: merchants whose wallet is in debit (aged first in, first out) and
 * cheques under collection, as of a Cairo day, with the payment reminders sent.
 */
export default async function FinanceReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const day = one(sp.day) || cairoDay(new Date());
  const q = one(sp.q);
  const query = new URLSearchParams({ day, ...(q ? { q } : {}) }).toString();
  const [report, profile, t] = await Promise.all([
    apiGet<
      ReceivablesAging & {
        reminderRules: { enabled: boolean; firstDays: number; everyDays: number; max: number };
      }
    >(`/finance/aging/receivables?${query}`),
    getMyProfile(),
    getTranslations('finance.aging'),
  ]);
  return (
    <>
      <h1 className="text-h2">
        {t('receivablesTitle')} <InfoTip term="receivables" />
      </h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('receivablesIntro')}</p>
      <details className="mt-2 max-w-3xl text-body-sm">
        <summary className="cursor-pointer font-semibold text-link">{t('howCounted')}</summary>
        <p className="mt-1 text-text-muted">{t('receivablesMethod')}</p>
      </details>
      <AgingFilters kind="receivables" day={report.asOf} q={q} />
      <ReceivablesAgingView
        report={report}
        query={query}
        canRemind={profile ? canDo(profile, 'accounting', 'use') : false}
        rules={report.reminderRules}
      />
    </>
  );
}
