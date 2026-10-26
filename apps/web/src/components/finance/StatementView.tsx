import { getLocale, getTranslations } from 'next-intl/server';
import type { Statement } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';

/** A merchant statement: opening balance, every movement with its running balance, closing. */
export async function StatementView({
  statement,
  from,
  to,
  exportHref,
}: {
  statement: Statement;
  from: string;
  to: string;
  exportHref: string;
}) {
  const [t, tf, locale] = await Promise.all([
    getTranslations('finance.merchants'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
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
          href={exportHref}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {tf('export')}
        </a>
      </form>

      <dl className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 md:grid-cols-4">
        <div>
          <dt className="text-caption text-text-muted">{t('opening')}</dt>
          <dd className="text-h3">
            <Amount piastres={statement.openingOwedPiastres} />
          </dd>
        </div>
        {Object.entries(statement.byKind).map(([kind, amount]) => (
          <div key={kind}>
            <dt className="text-caption text-text-muted">
              {tf.has(`kinds.${kind}`) ? tf(`kinds.${kind}`) : kind}
            </dt>
            <dd className="text-h3">
              <Amount piastres={amount} />
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-caption text-text-muted">{t('closing')}</dt>
          <dd className="text-h3">
            <Amount piastres={statement.closingOwedPiastres} strong />
          </dd>
        </div>
      </dl>

      {statement.lines.length === 0 ? (
        <p className="mt-6 text-body text-text-muted">{tf('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-body-sm">
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th className={th}>{t('date')}</th>
                <th className={th}>{t('type')}</th>
                <th className={th}>{t('order')}</th>
                <th className={`${th} text-end`}>EGP</th>
                <th className={`${th} text-end`}>{t('balance')}</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="ltr-iso whitespace-nowrap px-3 py-2">
                    {formatCairoDateTime(l.at, locale)}
                  </td>
                  <td className="px-3 py-2">
                    {tf.has(`kinds.${l.kind}`) ? tf(`kinds.${l.kind}`) : l.kind}
                  </td>
                  <td className="ltr-iso px-3 py-2">{l.orderNumber ?? l.memo ?? ''}</td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={l.amountPiastres} />
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Amount piastres={l.balanceAfterPiastres} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
