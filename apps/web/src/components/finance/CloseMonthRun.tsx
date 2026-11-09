'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import type { MonthEndChecklist } from '@/lib/cash-control-types';
import {
  canTickItem,
  CLOSE_STEPS,
  type CloseStep,
  closeProgress,
  monthEndFixHref,
  nextOpenStep,
} from '@/lib/close-run';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime } from '@/lib/format';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// The guided "Close the month" run (Accounting UX phase B): the live month end checklist one
// item at a time with the screen that fixes it, a hand tick with a note where allowed, and at
// the end closing the books through the month's last day with the existing lock.

const primary =
  'inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50';
const secondary =
  'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 font-bold hover:bg-surface-raised disabled:opacity-50';
const field = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm';

type Item = MonthEndChecklist['items'][number];

function Dot({ done, on }: { done: boolean; on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-caption font-bold ${
        done
          ? 'bg-status-delivered text-white'
          : on
            ? 'bg-primary text-on-primary'
            : 'border-2 border-line-strong'
      }`}
    >
      {done ? '✓' : ''}
    </span>
  );
}

export function CloseMonthRun({
  list,
  months,
  step,
  canTick,
  canClose,
}: {
  list: MonthEndChecklist;
  months: string[];
  step: CloseStep;
  canTick: boolean;
  canClose: boolean;
}) {
  const t = useTranslations('finance.closeRun');
  const tm = useTranslations('cashControl.monthEnd');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const action = useFinanceAction();
  const [note, setNote] = useState('');
  const progress = closeProgress(list);
  const closed = !!list.closedThrough && list.closedThrough >= list.lastDay;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const go = (s: CloseStep, month = list.month) => {
    setNote('');
    action.setMessage(null);
    startTransition(() => router.push(`${pathname}?month=${month}&step=${s}`, { scroll: false }));
  };
  const itemOf = (s: CloseStep) => list.items.find((i) => i.id === s);
  const stateOf = (item: Item) =>
    item.done
      ? tm('done')
      : item.notYet
        ? tm('notYet')
        : item.automatic
          ? tm('left', { count: item.left })
          : tm('toTick');

  let body: ReactNode;
  if (step === 'close') {
    const missing = list.items.filter((i) => i.id !== 'books_closed' && !i.done);
    body = (
      <>
        <h2 className="text-h3">{t('closeTitle')}</h2>
        {closed ? (
          <p className="rounded-md bg-selected-bg px-3 py-2 text-body font-semibold">
            {tm('closed', { day: isoToDayFirst(list.closedThrough ?? list.lastDay) })}
          </p>
        ) : !list.over ? (
          <p className="text-body-sm text-text-muted">{t('notOver')}</p>
        ) : (
          <>
            <p className="text-body-sm text-text-muted">{t('closeIntro')}</p>
            {missing.length > 0 && (
              <div>
                <p className="text-body-sm font-semibold">{t('stillOpen')}</p>
                <ul className="mt-1 space-y-1 text-body-sm">
                  {missing.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        className="text-link underline"
                        onClick={() => go(i.id as CloseStep)}
                      >
                        {tm(`items.${i.id}.name`)}
                      </button>{' '}
                      · <span className="text-text-muted">{stateOf(i)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {canClose ? (
              <button
                type="button"
                className={primary}
                disabled={action.busy || !list.readyToClose}
                onClick={() =>
                  void action.send('POST', '/finance/books-lock', { day: list.lastDay }, () =>
                    t('closedNow', { day: isoToDayFirst(list.lastDay) }),
                  )
                }
              >
                {t('closeButton', { day: isoToDayFirst(list.lastDay) })}
              </button>
            ) : (
              <p className="text-body-sm text-text-muted">{t('cannotClose')}</p>
            )}
            <p className="text-caption text-text-muted">{t('closeHint')}</p>
          </>
        )}
      </>
    );
  } else {
    const item = itemOf(step)!;
    const next = nextOpenStep(list, step);
    body = (
      <>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-h3">{tm(`items.${item.id}.name`)}</h2>
            <p className="mt-1 text-body-sm text-text-muted">{tm(`items.${item.id}.hint`)}</p>
          </div>
          <span
            className={`rounded-pill px-3 py-1 text-body-sm font-bold ${
              item.done
                ? 'bg-selected-bg text-status-delivered'
                : item.notYet
                  ? 'bg-surface-raised text-text-muted'
                  : 'bg-surface-raised text-status-needs-action'
            }`}
          >
            {stateOf(item)}
          </span>
        </div>
        <p className="text-body-sm">{t(`why.${item.id}`)}</p>
        {item.mark && (
          <p className="text-caption text-text-muted">
            {tm('markedBy', { name: item.mark.by, note: item.mark.note })} ·{' '}
            <span className="ltr-iso">{formatCairoDateTime(item.mark.at, locale)}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!item.done && (
            <Link href={monthEndFixHref(item.id, list.month)} className={primary}>
              {t(`fix.${item.id}`)}
            </Link>
          )}
          <button
            type="button"
            className={secondary}
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            {t('checkAgain')}
          </button>
          {canTick && item.mark && (
            <button
              type="button"
              className={secondary}
              disabled={action.busy}
              onClick={() =>
                void action.send(
                  'DELETE',
                  `/finance/month-end/${list.month}/marks/${item.id}`,
                  undefined,
                )
              }
            >
              {tm('untick')}
            </button>
          )}
        </div>
        {canTick && canTickItem(item) && (
          <div className="space-y-2 rounded-md border border-line p-3">
            <p className="text-body-sm font-semibold">{t('tickTitle')}</p>
            <p className="text-caption text-text-muted">
              {item.automatic ? t('tickHintAuto') : t('tickHintManual')}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-caption">
                {tm('note')}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={`${field} mt-1 block w-full`}
                />
              </label>
              <button
                type="button"
                className={secondary}
                disabled={action.busy || note.trim().length < 3}
                onClick={async () => {
                  const done = await action.send(
                    'POST',
                    `/finance/month-end/${list.month}/marks`,
                    { item: item.id, note },
                    () => t('ticked'),
                  );
                  if (done) setNote('');
                }}
              >
                {tm('saveTick')}
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          {CLOSE_STEPS.indexOf(step) > 0 ? (
            <button
              type="button"
              className={secondary}
              onClick={() => go(CLOSE_STEPS[CLOSE_STEPS.indexOf(step) - 1]!)}
            >
              {t('back')}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={item.done ? primary : secondary}
            onClick={() => go(next)}
          >
            {next === 'close' ? t('toClose') : t('nextOpen')}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={`mt-4 space-y-4 ${pending ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-3">
        <label className="text-caption">
          {tm('month')}
          <select
            value={list.month}
            onChange={(e) => go('cash_handovers', e.target.value)}
            className={`${field} ltr-iso mt-1 block`}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-48 flex-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={t('progressLabel')}
            className="h-2.5 overflow-hidden rounded-pill bg-surface-raised"
          >
            <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-caption text-text-muted">
            {tm('progress', { done: progress.done, total: progress.total })}
            {!list.over && <span className="ms-2">{tm('notOver')}</span>}
            {closed && <span className="ms-2">{t('alreadyClosed')}</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <ol aria-label={t('stepsLabel')} className="space-y-1">
          {CLOSE_STEPS.map((s, i) => {
            const on = s === step;
            const it = itemOf(s);
            const done = s === 'close' ? closed : !!it?.done;
            return (
              <li key={s}>
                <button
                  type="button"
                  aria-current={on ? 'step' : undefined}
                  onClick={() => go(s)}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-start text-body-sm ${on ? 'bg-selected-bg font-bold text-link' : 'hover:bg-surface-raised'}`}
                >
                  <Dot done={done} on={on} />
                  <span className="min-w-0 flex-1">
                    {i + 1}. {s === 'close' ? t('closeTitle') : tm(`items.${s}.name`)}
                  </span>
                  {it && !it.done && it.automatic && !it.notYet && it.left > 0 && (
                    <span className="ltr-iso rounded-pill bg-surface-raised px-2 text-caption">
                      {it.left}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <section className="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-4">
          {body}
          <ActionMessage message={action.message} />
        </section>
      </div>
    </div>
  );
}
