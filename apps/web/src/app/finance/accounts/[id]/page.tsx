import { RecordHistory } from '@/components/workflow/RecordHistory';
import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { apiGet } from '@/lib/api-server';
import type { AccountStatement } from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function AccountStatementPage({
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
  const range = new URLSearchParams({ from, to });
  const [s, t, tf, locale] = await Promise.all([
    apiGet<AccountStatement>(`/finance/accounts/${id}/statement?${range}`),
    getTranslations('finance.accounts'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const name = locale === 'ar' ? s.account.nameAr || s.account.nameEn : s.account.nameEn;
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const bank = [s.account.bankName, s.account.accountNumber, s.account.iban]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Link href="/finance/accounts" className="text-body-sm text-link">
        {t('back')}
      </Link>
      <h1 className="mt-2 text-h2">
        <span className="ltr-iso me-2 text-text-muted">{s.account.code}</span>
        {name}
      </h1>
      {bank && <p className="ltr-iso text-body-sm text-text-muted">{bank}</p>}
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {tf('from')}
          <input type="date" name="from" defaultValue={from} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <input type="date" name="to" defaultValue={to} dir="ltr" className={field} />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
        <a
          href={`/api/finance/accounts/${id}/statement.csv?${range}`}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {tf('export')}
        </a>
      </form>
      <dl className="mt-4 grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['opening', s.openingPiastres],
            ['totalDebit', s.totalDebitPiastres],
            ['totalCredit', s.totalCreditPiastres],
            ['closing', s.closingPiastres],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-3">
            <dt className="text-caption text-text-muted">{t(k)}</dt>
            <dd className="text-h3">
              <Amount piastres={v} />
            </dd>
          </div>
        ))}
      </dl>
      {s.lines.length === 0 ? (
        <p className="mt-6 text-body text-text-muted">{tf('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[900px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className={th}>{tf('journal.when')}</th>
                <th className={th}>{tf('journal.voucher')}</th>
                <th className={th}>{tf('journal.what')}</th>
                <th className={th}>{t('against')}</th>
                <th className={`${th} text-end`}>{tf('journal.debit')}</th>
                <th className={`${th} text-end`}>{tf('journal.credit')}</th>
                <th className={`${th} text-end`}>{t('balance')}</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={`${l.entryId}-${l.number}`} className="border-b border-line align-top">
                  <td className="ltr-iso whitespace-nowrap px-3 py-2">
                    {formatCairoDateTime(l.at, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/finance/journal?number=${l.number}`}
                      className="ltr-iso font-bold text-link"
                    >
                      {l.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {tf.has(`kinds.${l.kind}`) ? tf(`kinds.${l.kind}`) : l.kind}
                    <p className="text-caption text-text-muted">
                      {[l.reference ?? l.orderNumber, l.memo].filter(Boolean).join(' · ')}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-caption">
                    {l.against.map((a) => (
                      <p key={a.code}>
                        <span className="ltr-iso">{a.code}</span>{' '}
                        {locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn}
                      </p>
                    ))}
                  </td>
                  <td className="ltr-iso px-3 py-2 text-end">
                    {l.debitPiastres ? formatEgp(l.debitPiastres) : ''}
                  </td>
                  <td className="ltr-iso px-3 py-2 text-end">
                    {l.creditPiastres ? formatEgp(l.creditPiastres) : ''}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={l.balancePiastres} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordHistory entityType="ledger_account" entityId={s.account.id} />
    </>
  );
}
