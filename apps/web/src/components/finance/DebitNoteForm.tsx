'use client';

import { DEBIT_NOTE_KINDS, type DebitNoteKind } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { InvoiceDetail } from '@/lib/finance-types';
import { newActionKey } from '@/lib/ids';
import { parseEgp } from '@/lib/money';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';

interface Line {
  kind: DebitNoteKind;
  quantity: string;
  amount: string;
}

/**
 * Debit notes of an invoice and the form to issue one: charges the merchant more after the
 * invoice (a missed fee, a correction), one line per fee kind before VAT. It raises what the
 * merchant owes, so it waits for a second person while money in is checked.
 */
export function DebitNotes({
  invoice,
  stores,
  canIssue,
}: {
  invoice: InvoiceDetail;
  stores: { id: string; label: string }[];
  canIssue: boolean;
}) {
  const t = useTranslations('finance.debitNotes');
  const action = useFinanceAction();
  const [lines, setLines] = useState<Line[]>([{ kind: 'order_fee', quantity: '1', amount: '' }]);
  const [reason, setReason] = useState('');
  const [store, setStore] = useState('');
  const notes = invoice.debitNotes ?? [];
  if (invoice.type !== 'invoice') return null;
  const parsed = lines.map((l) => ({
    kind: l.kind,
    quantity: Number.parseInt(l.quantity, 10) || 1,
    netPiastres: parseEgp(l.amount),
  }));
  const valid =
    reason.trim().length >= 5 && parsed.every((l) => l.netPiastres && l.netPiastres > 0);
  const set = (i: number, patch: Partial<Line>) =>
    setLines((was) => was.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="mt-6 max-w-3xl space-y-4 print:hidden">
      {notes.length > 0 && (
        <p className="text-body-sm">
          {t('list')}:{' '}
          {notes.map((d) => (
            <a key={d.id} href={`/finance/invoices/${d.id}`} className="ltr-iso me-2 underline">
              {d.label}
            </a>
          ))}
        </p>
      )}
      {canIssue && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('title')}</h2>
          <p className="text-caption text-text-muted">{t('hint')}</p>
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <select
                value={l.kind}
                aria-label={t('kind')}
                onChange={(e) => set(i, { kind: e.target.value as DebitNoteKind })}
                className={field}
              >
                {DEBIT_NOTE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </select>
              <input
                value={l.quantity}
                onChange={(e) => set(i, { quantity: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                aria-label={t('quantity')}
                placeholder={t('quantity')}
                className={field}
              />
              <input
                value={l.amount}
                onChange={(e) => set(i, { amount: e.target.value })}
                inputMode="decimal"
                dir="ltr"
                aria-label={t('amountBeforeVat')}
                placeholder={t('amountBeforeVat')}
                className={field}
              />
              <button
                type="button"
                className={secondary}
                disabled={lines.length === 1}
                onClick={() => setLines((was) => was.filter((_, j) => j !== i))}
              >
                {t('removeLine')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className={secondary}
            disabled={lines.length >= 20}
            onClick={() =>
              setLines((was) => [...was, { kind: 'adjustment', quantity: '1', amount: '' }])
            }
          >
            {t('addLine')}
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reason')}
              aria-label={t('reason')}
              className={field}
            />
            <select
              value={store}
              aria-label={t('store')}
              onChange={(e) => setStore(e.target.value)}
              className={field}
            >
              <option value="">{t('companyWide')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-caption text-text-muted">{t('vatHint')}</p>
          <button
            type="button"
            className={primary}
            disabled={action.busy || !valid}
            onClick={async () => {
              const ok = await action.send('POST', `/finance/invoices/${invoice.id}/debit-notes`, {
                lines: parsed,
                reason,
                darkStoreId: store || null,
                idempotencyKey: newActionKey(),
              });
              if (ok) {
                setLines([{ kind: 'order_fee', quantity: '1', amount: '' }]);
                setReason('');
              }
            }}
          >
            {t('issue')}
          </button>
          <ActionMessage message={action.message} />
        </section>
      )}
    </div>
  );
}
