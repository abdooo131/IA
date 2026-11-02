import { getLocale, getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { PrintButton } from '@/components/finance/PrintButton';
import { apiGet } from '@/lib/api-server';
import type { PartnerLedger } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { entryNumber } from '@shiplynow/shared';

export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { kind, id } = await params;
  const q = await searchParams;
  const query = new URLSearchParams();
  if (q.from) query.set('from', q.from);
  if (q.to) query.set('to', q.to);
  const [ledger, t, tf, locale] = await Promise.all([
    apiGet<PartnerLedger>(`/finance/partners/${kind}/${id}?${query}`),
    getTranslations('finance.partners'),
    getTranslations('finance'),
    getLocale(),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <a href="/finance/partners" className="text-body-sm underline print:hidden">
            {t('back')}
          </a>
          <h1 className="text-h2">{ledger.name}</h1>
        </div>
        <PrintButton />
      </div>
      <form className="mt-3 flex flex-wrap items-end gap-2 print:hidden">
        <input
          type="date"
          name="from"
          defaultValue={q.from}
          dir="ltr"
          className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={q.to}
          dir="ltr"
          className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
        />
        <button className="h-10 rounded-md border border-line px-3 text-body-sm font-bold">
          {t('show')}
        </button>
      </form>
      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        {ledger.accounts.map((a) => (
          <div key={a.id} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-caption text-text-muted">
              <span className="ltr-iso">{a.code}</span> ·{' '}
              {tf.has(`accounts.${a.type}`) ? tf(`accounts.${a.type}`) : a.type}
            </p>
            <p className="text-h3">
              <Amount piastres={a.balancePiastres} />
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-caption text-text-muted">{t('net')}</p>
          <p className="text-h3">
            <Amount piastres={ledger.netPiastres} strong />
          </p>
          <p className="text-caption text-text-muted">
            {ledger.netPiastres > 0 ? t('owesUs') : ledger.netPiastres < 0 ? t('weOwe') : t('even')}
          </p>
        </div>
      </section>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('date')}</th>
              <th className={th}>{t('entry')}</th>
              <th className={th}>{t('account')}</th>
              <th className={`${th} text-end`}>{t('amount')}</th>
              <th className={`${th} text-end`}>{t('running')}</th>
            </tr>
          </thead>
          <tbody>
            {q.from && (
              <tr className="border-t border-line">
                <td className={td} colSpan={4}>
                  {t('opening')}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={ledger.openingPiastres} />
                </td>
              </tr>
            )}
            {ledger.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className={td}>{formatCairoDateTime(l.at, locale)}</td>
                <td className={td}>
                  <span className="ltr-iso font-bold">{entryNumber(l.entryNumber)}</span>{' '}
                  {tf.has(`kinds.${l.kind}`) ? tf(`kinds.${l.kind}`) : l.kind}
                  {l.memo && <span className="block text-caption text-text-muted">{l.memo}</span>}
                </td>
                <td className={`${td} ltr-iso`}>{l.accountCode}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={l.amountPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={l.runningPiastres} strong />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('signHint')}</p>
    </>
  );
}
