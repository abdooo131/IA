'use client';

import type { MonthEndItem } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MonthEndChecklist } from '@/lib/cash-control-types';
import { formatCairoDateTime } from '@/lib/format';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';

/** Where each item is worked on. */
const LINKS: Record<MonthEndItem, string> = {
  cash_handovers: '/finance/cash',
  bank_lines: '/finance/bank',
  receipts: '/finance/receipts',
  petty_cash: '/finance/petty-cash?status=pending',
  invoices: '/finance/invoices',
  payroll: '/finance/payroll',
  storage: '/finance/journal',
  depreciation: '/finance/assets',
  vat_return: '/finance/tax-returns',
  books_closed: '/finance/close',
};

function Item({
  item,
  month,
  canTick,
}: {
  item: MonthEndChecklist['items'][number];
  month: string;
  canTick: boolean;
}) {
  const t = useTranslations('cashControl.monthEnd');
  const locale = useLocale();
  const action = useFinanceAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const state = item.done
    ? t('done')
    : item.notYet
      ? t('notYet')
      : item.automatic
        ? t('left', { count: item.left })
        : t('toTick');
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-caption font-bold ${
              item.done ? 'bg-status-delivered text-white' : 'border-2 border-line-strong'
            }`}
          >
            {item.done ? '✓' : ''}
          </span>
          <span className="min-w-0">
            <span className="block text-body font-bold">{t(`items.${item.id}.name`)}</span>
            <span className="block text-body-sm text-text-muted">{t(`items.${item.id}.hint`)}</span>
            {item.mark && (
              <span className="mt-1 block text-caption text-text-muted">
                {t('markedBy', { name: item.mark.by, note: item.mark.note })} ·{' '}
                <span className="ltr-iso">{formatCairoDateTime(item.mark.at, locale)}</span>
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-body-sm">
          <span
            className={`font-semibold ${
              item.done
                ? 'text-status-delivered'
                : item.notYet
                  ? 'text-text-muted'
                  : 'text-status-needs-action'
            }`}
          >
            {state}
          </span>
          <Link href={LINKS[item.id]} className="font-bold text-link">
            {t('open')}
          </Link>
          {canTick &&
            item.id !== 'books_closed' &&
            !item.mark &&
            !(item.done && item.automatic) && (
              <button
                type="button"
                className="font-bold text-link"
                onClick={() => setOpen((v) => !v)}
              >
                {t('tick')}
              </button>
            )}
          {canTick && item.mark && (
            <button
              type="button"
              className="font-bold text-link"
              disabled={action.busy}
              onClick={() =>
                void action.send(
                  'DELETE',
                  `/finance/month-end/${month}/marks/${item.id}`,
                  undefined,
                )
              }
            >
              {t('untick')}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-2 ps-9">
          <label className="min-w-0 flex-1 text-caption">
            {t('note')}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${field} mt-1 block w-full`}
            />
          </label>
          <button
            type="button"
            disabled={action.busy || note.trim().length < 3}
            onClick={async () => {
              const done = await action.send('POST', `/finance/month-end/${month}/marks`, {
                item: item.id,
                note,
              });
              if (done) setOpen(false);
            }}
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
          >
            {t('saveTick')}
          </button>
        </div>
      )}
      <div className="ps-9">
        <ActionMessage message={action.message} />
      </div>
    </li>
  );
}

/** The live month end checklist with its month picker and the close button. */
export function MonthEndChecklistView({
  list,
  months,
  canTick,
  canClose,
}: {
  list: MonthEndChecklist;
  months: string[];
  canTick: boolean;
  canClose: boolean;
}) {
  const t = useTranslations('cashControl.monthEnd');
  const router = useRouter();
  const close = useFinanceAction();
  const closed = !!list.closedThrough && list.closedThrough >= list.lastDay;
  const done = list.items.filter((i) => i.done).length;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-caption">
          {t('month')}
          <select
            value={list.month}
            onChange={(e) => router.push(`/finance/month-end?month=${e.target.value}`)}
            className={`${field} ltr-iso mt-1 block`}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <p className="text-body-sm">
          {t('progress', { done, total: list.items.length })}
          {!list.over && <span className="ms-2 text-text-muted">{t('notOver')}</span>}
        </p>
      </div>
      <ol className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
        {list.items.map((item) => (
          <Item key={item.id} item={item} month={list.month} canTick={canTick} />
        ))}
      </ol>
      <section className="mt-4 rounded-lg border border-line bg-surface p-4">
        {closed ? (
          <p className="text-body">{t('closed', { day: list.closedThrough ?? '' })}</p>
        ) : (
          <>
            <p className="text-body-sm text-text-muted">
              {list.readyToClose ? t('ready') : t('notReady')}
            </p>
            {canClose && (
              <button
                type="button"
                disabled={close.busy || !list.readyToClose}
                onClick={() =>
                  void close.send('POST', '/finance/books-lock', { day: list.lastDay })
                }
                className="mt-3 h-11 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
              >
                {t('close', { day: list.lastDay })}
              </button>
            )}
            <ActionMessage message={close.message} />
          </>
        )}
      </section>
    </>
  );
}
