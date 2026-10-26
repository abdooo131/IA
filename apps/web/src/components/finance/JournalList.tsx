'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiGetClient } from '@/lib/api-client';
import type { JournalPage } from '@/lib/finance-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export function JournalList({ first, query }: { first: JournalPage; query: string }) {
  const t = useTranslations('finance.journal');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const [rows, setRows] = useState(first.rows);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [busy, setBusy] = useState(false);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    const params = new URLSearchParams(query);
    params.set('cursor', cursor);
    const result = await apiGetClient<JournalPage>(`/finance/ledger?${params}`);
    setBusy(false);
    if (!result.ok) return;
    setRows((r) => [...r, ...result.data.rows]);
    setCursor(result.data.nextCursor);
  }

  if (rows.length === 0) return <p className="mt-6 text-body text-text-muted">{tf('empty')}</p>;
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[860px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={th}>{t('when')}</th>
              <th className={th}>{t('what')}</th>
              <th className={th}>{t('account')}</th>
              <th className={`${th} text-end`}>{t('debit')}</th>
              <th className={`${th} text-end`}>{t('credit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) =>
              e.lines.map((l, i) => (
                <tr
                  key={`${e.id}-${i}`}
                  className={i === e.lines.length - 1 ? 'border-b border-line' : ''}
                >
                  {i === 0 && (
                    <>
                      <td
                        rowSpan={e.lines.length}
                        className="ltr-iso whitespace-nowrap px-3 py-2 align-top"
                      >
                        {formatCairoDateTime(e.at, locale)}
                      </td>
                      <td rowSpan={e.lines.length} className="px-3 py-2 align-top">
                        <span className="font-bold">
                          {tf.has(`kinds.${e.kind}`) ? tf(`kinds.${e.kind}`) : e.kind}
                        </span>
                        <p className="ltr-iso text-caption text-text-muted">
                          {[e.orderNumber, e.orderNumber ? null : e.memo].filter(Boolean).join(' ')}
                        </p>
                        {e.by && (
                          <p className="text-caption text-text-muted">{tf('by', { name: e.by })}</p>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-1">
                    {tf.has(`accounts.${l.accountType}`)
                      ? tf(`accounts.${l.accountType}`)
                      : l.accountType}
                    {l.owner && <span className="text-text-muted"> · {l.owner}</span>}
                  </td>
                  <td className="ltr-iso px-3 py-1 text-end">
                    {l.amountPiastres > 0 ? formatEgp(l.amountPiastres) : ''}
                  </td>
                  <td className="ltr-iso px-3 py-1 text-end">
                    {l.amountPiastres < 0 ? formatEgp(0 - l.amountPiastres) : ''}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void more()}
          className="mt-4 h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50"
        >
          {tf('loadMore')}
        </button>
      )}
    </>
  );
}
