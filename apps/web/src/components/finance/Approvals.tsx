'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import type { FinanceRequestRow, PayoutRow } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';

function RequestCard({
  request,
  meId,
  canDecide,
}: {
  request: FinanceRequestRow;
  meId: string;
  /** Accounting manage: only they may approve or reject (the API refuses everyone else) */
  canDecide: boolean;
}) {
  const t = useTranslations('finance.approvals');
  const locale = useLocale();
  const action = useFinanceAction();
  const [note, setNote] = useState('');
  const mine = request.requestedBy.id === meId;
  return (
    <li className="space-y-2 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-body font-bold">{t(`kinds.${request.kind}`)}</p>
          <p className="text-body-sm">{request.reference}</p>
          {request.memo && <p className="text-caption text-text-muted">{request.memo}</p>}
          <p className="text-caption text-text-muted">
            {t('askedBy', { name: request.requestedBy.name })} ·{' '}
            <span className="ltr-iso">{formatCairoDateTime(request.createdAt, locale)}</span>
            {request.day && (
              <>
                {' '}
                · {t('dated')} <span className="ltr-iso">{request.day}</span>
              </>
            )}{' '}
            · {t('receipts', { count: request.receipts })}
          </p>
        </div>
        <p className="text-h3">
          <Amount piastres={request.amountPiastres} strong /> EGP
        </p>
      </div>
      {mine ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-text-muted">{t('yours')}</span>
          <button
            type="button"
            className={button}
            disabled={action.busy}
            onClick={() => void action.send('POST', `/finance/requests/${request.id}/cancel`, {})}
          >
            {t('withdraw')}
          </button>
        </div>
      ) : !canDecide ? (
        <p className="text-caption text-text-muted">{t('waitingForManager')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primary}
            disabled={action.busy}
            onClick={() =>
              void action.send('POST', `/finance/requests/${request.id}/decide`, { approve: true })
            }
          >
            {t('approve')}
          </button>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('rejectNote')}
            aria-label={t('rejectNote')}
            className={`${field} min-w-0 flex-1`}
          />
          <button
            type="button"
            className={`${button} text-danger`}
            disabled={action.busy || note.trim().length < 3}
            onClick={() =>
              void action.send('POST', `/finance/requests/${request.id}/decide`, {
                approve: false,
                note,
              })
            }
          >
            {t('reject')}
          </button>
        </div>
      )}
      <ActionMessage message={action.message} />
    </li>
  );
}

/** Everything waiting for a second person: money movements and large payouts. */
export function Approvals({
  requests,
  payouts,
  decided,
  meId,
  canDecide,
}: {
  requests: FinanceRequestRow[];
  payouts: PayoutRow[];
  decided: FinanceRequestRow[];
  meId: string;
  canDecide: boolean;
}) {
  const t = useTranslations('finance.approvals');
  const locale = useLocale();
  return (
    <div className="mt-4 space-y-6">
      <section>
        <h2 className="text-h3">{t('movements')}</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} meId={meId} canDecide={canDecide} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-h3">{t('payouts')}</h2>
        {payouts.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('none')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 text-body-sm"
              >
                <span>
                  <span className="ltr-iso me-2 text-link">{p.number}</span>
                  {p.merchant.name} · {t('askedBy', { name: p.createdBy })}
                </span>
                <span className="flex items-center gap-3">
                  <Amount piastres={p.amountPiastres} strong /> EGP
                  <Link href="/finance/payouts" className="font-bold text-link underline">
                    {t('open')}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {decided.length > 0 && (
        <section>
          <h2 className="text-h3">{t('recent')}</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-body-sm">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>
                  {t(`kinds.${r.kind}`)} · {r.reference} · {t(`statuses.${r.status}`)}
                  {r.decidedBy && <> · {r.decidedBy}</>}
                  {r.decisionNote && <span className="text-text-muted"> · {r.decisionNote}</span>}
                </span>
                <span className="text-text-muted">
                  <Amount piastres={r.amountPiastres} /> EGP ·{' '}
                  <span className="ltr-iso">
                    {r.decidedAt ? formatCairoDateTime(r.decidedAt, locale) : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export { RequestCard };
