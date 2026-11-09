'use client';

import { MATCH_WINDOW_DAYS, type MatchSuggestion, sumMatches } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import { Amount } from './Amount';

// The bank matching screen (Accounting UX phase B), like Odoo's reconciliation widget: the
// bank's lines still open on the left, newest first; the selected one's suggested ledger lines
// on the right with the reason for each, one click (or Enter) to match the top one, several
// lines that add up exactly, a bank charge in one tap, or set aside with a reason.

export interface BankMatchingData {
  account: { id: string; code: string; nameEn: string; nameAr: string };
  statements: {
    id: string;
    number: string;
    fileName: string;
    fromDay: string;
    toDay: string;
    total: number;
    done: number;
  }[];
  statement: { id: string; number: string; total: number; done: number } | null;
  months: string[];
  openCount: number;
  lines: {
    id: string;
    statement: string;
    lineNo: number;
    day: string;
    description: string;
    reference: string | null;
    amountPiastres: number;
    suggestions: MatchSuggestion[];
  }[];
  openLines: {
    id: string;
    entryId: string;
    entryNumber: string;
    kind: string;
    memo: string | null;
    day: string;
    amountPiastres: number;
  }[];
}

const btn =
  'inline-flex h-10 items-center justify-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold hover:bg-surface-raised disabled:opacity-50';
const primary =
  'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50';
const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';

const gap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export function BankMatching({ data, canWrite }: { data: BankMatchingData; canWrite: boolean }) {
  const t = useTranslations('finance.bankMatch');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const line = data.lines[Math.min(index, data.lines.length - 1)] ?? null;
  const byId = useMemo(() => new Map(data.openLines.map((l) => [l.id, l])), [data.openLines]);
  useEffect(() => {
    setPicked(new Set());
    setNote('');
  }, [line?.id]);
  useEffect(() => {
    if (index >= data.lines.length) setIndex(Math.max(0, data.lines.length - 1));
  }, [data.lines.length, index]);

  const go = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };

  const kindName = (k: string) => (tf.has(`kinds.${k}`) ? tf(`kinds.${k}`) : k);
  const errorText = (code: string) =>
    t.has(`errors.${code}`)
      ? t(`errors.${code}`)
      : tf.has(`merchants.errors.${code}`)
        ? tf(`merchants.errors.${code}`)
        : tf('merchants.errors.generic');

  const send = useCallback(
    async (path: string, body: unknown, done: string) => {
      setBusy(true);
      setMessage(null);
      const r = await apiSend<{ status?: string }>('POST', path, body);
      setBusy(false);
      if (!r.ok) {
        setMessage({ text: errorText(r.error), error: true });
        return false;
      }
      setMessage({
        text:
          r.data && (r.data as { status?: string }).status === 'pending'
            ? tf('sentForApproval')
            : done,
        error: false,
      });
      router.refresh();
      return true;
    },
    // errorText and the translators are stable for the page's life.
    [router],
  );

  const match = useCallback(
    (ids: string[]) =>
      line && canWrite
        ? send(`/finance/bank-lines/${line.id}/match-many`, { ledgerLineIds: ids }, t('matched'))
        : Promise.resolve(false),
    [line, canWrite, send, t],
  );
  const top = line?.suggestions.find((s) => s.matchable) ?? null;

  // Keyboard: up and down (or j and k) move through the bank lines, Enter matches the top
  // suggestion and / goes to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, data.lines.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (
        e.key === 'Enter' &&
        top &&
        !busy &&
        el?.tagName !== 'BUTTON' &&
        el?.tagName !== 'A'
      ) {
        e.preventDefault();
        void match(top.ids);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data.lines.length, top, busy, match]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // Lines to pick by hand: same direction, around the bank line's day.
  const candidates = line
    ? data.openLines.filter(
        (l) =>
          Math.sign(l.amountPiastres) === Math.sign(line.amountPiastres) &&
          gap(l.day, line.day) <= MATCH_WINDOW_DAYS + 7,
      )
    : [];
  const pickedSum = [...picked].reduce((s, id) => s + (byId.get(id)?.amountPiastres ?? 0), 0);
  const pickedOk = line
    ? sumMatches(
        line.amountPiastres,
        [...picked].map((id) => byId.get(id)?.amountPiastres ?? 0),
      )
    : false;

  const progress = data.statement;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className={`mt-4 space-y-4 ${pending ? 'opacity-70' : ''}`}>
      {/* Statement, progress, month and search */}
      <div className="grid gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <label className="block text-caption">
            {t('statement')}
            <select
              value={progress?.id ?? ''}
              onChange={(e) => go('statement', e.target.value)}
              className={`${field} mt-1`}
            >
              {data.statements.length === 0 && <option value="">{t('noStatement')}</option>}
              {data.statements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.fileName} · {isoToDayFirst(s.fromDay)} → {isoToDayFirst(s.toDay)}
                </option>
              ))}
            </select>
          </label>
          {progress && (
            <div className="mt-2">
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
                {t('progress', { done: progress.done, total: progress.total, pct })}
              </p>
            </div>
          )}
        </div>
        <label className="block text-caption">
          {t('month')}
          <select
            value={params.get('month') ?? ''}
            onChange={(e) => go('month', e.target.value)}
            className={`${field} mt-1`}
          >
            <option value="">{t('allMonths')}</option>
            {data.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <form
          className="block text-caption"
          onSubmit={(e) => {
            e.preventDefault();
            go('q', search.trim());
          }}
        >
          <label className="block">
            {t('search')}
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchHint')}
              className={`${field} mt-1`}
            />
          </label>
        </form>
      </div>

      {data.lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-body font-bold">{t('allMatched')}</p>
          <p className="mt-1 text-body-sm text-text-muted">{t('allMatchedHint')}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* Left: the bank's lines still open */}
          <section
            aria-labelledby="bank-lines"
            className="min-w-0 rounded-lg border border-line bg-surface"
          >
            <h2
              id="bank-lines"
              className="flex items-center justify-between border-b border-line px-3 py-2 text-body font-bold"
            >
              {t('bankLines', { count: data.openCount })}
              <span className="text-caption font-normal text-text-muted">{t('keysHint')}</span>
            </h2>
            <ul
              ref={listRef}
              role="listbox"
              aria-label={t('bankLinesLabel')}
              className="max-h-[60dvh] divide-y divide-line overflow-y-auto"
            >
              {data.lines.map((l, i) => {
                const on = l.id === line?.id;
                const best = l.suggestions[0];
                return (
                  <li key={l.id} data-index={i} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-start ${on ? 'bg-selected-bg' : 'hover:bg-surface-raised'}`}
                    >
                      <span className="min-w-0">
                        <span className="ltr-iso block text-caption text-text-muted">
                          {isoToDayFirst(l.day)} · {l.statement}/{l.lineNo}
                        </span>
                        <span className="block break-words text-body-sm font-semibold">
                          {l.description}
                        </span>
                        {best && (
                          <span className="mt-0.5 inline-block rounded-pill bg-surface-raised px-2 text-caption text-text-muted">
                            {t(`reasons.${best.reason}`)}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-body-sm">
                        <Amount piastres={l.amountPiastres} strong />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Right: what proves the selected line */}
          {line && (
            <section
              aria-labelledby="match-panel"
              className="min-w-0 space-y-3 rounded-lg border border-line bg-surface p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 id="match-panel" className="break-words text-body font-bold">
                    {line.description}
                  </h2>
                  <p className="ltr-iso text-caption text-text-muted">
                    {isoToDayFirst(line.day)} · {line.statement}/{line.lineNo}
                    {line.reference ? ` · ${line.reference}` : ''}
                  </p>
                </div>
                <span className="text-h3">
                  <Amount piastres={line.amountPiastres} strong />
                </span>
              </div>

              <div>
                <h3 className="text-label uppercase text-text-muted">{t('suggestions')}</h3>
                {line.suggestions.length === 0 ? (
                  <p className="mt-1 text-body-sm text-text-muted">{t('noSuggestions')}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-line rounded-md border border-line">
                    {line.suggestions.map((s, i) => {
                      const items = s.ids.map((id) => byId.get(id)).filter(Boolean);
                      return (
                        <li
                          key={s.ids.join(',')}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <div className="min-w-0 text-body-sm">
                            <span
                              className={`me-2 inline-block rounded-pill px-2 text-caption font-bold ${s.matchable ? 'bg-selected-bg text-link' : 'bg-surface-raised text-text-muted'}`}
                            >
                              {t(`reasons.${s.reason}`)}
                            </span>
                            {items.map((l) => (
                              <span key={l!.id} className="block">
                                <Link
                                  href={`/finance/journal/${l!.entryId}`}
                                  className="ltr-iso font-bold text-link"
                                >
                                  {l!.entryNumber}
                                </Link>{' '}
                                · <span className="ltr-iso">{isoToDayFirst(l!.day)}</span> ·{' '}
                                {kindName(l!.kind)} · <Amount piastres={l!.amountPiastres} />
                                {l!.memo && (
                                  <span className="block text-caption text-text-muted">
                                    {l!.memo}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                          {s.matchable && canWrite && (
                            <button
                              type="button"
                              className={i === 0 ? primary : btn}
                              disabled={busy}
                              onClick={() => void match(s.ids)}
                            >
                              {i === 0 ? t('matchTop') : t('match')}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {canWrite && candidates.length > 0 && (
                <details className="rounded-md border border-line">
                  <summary className="flex min-h-10 cursor-pointer items-center px-3 text-body-sm font-bold">
                    {t('pickByHand')}
                  </summary>
                  <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                    {candidates.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-start gap-2 px-3 py-2 text-body-sm">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={picked.has(c.id)}
                            onChange={() =>
                              setPicked((p) => {
                                const n = new Set(p);
                                if (n.has(c.id)) n.delete(c.id);
                                else n.add(c.id);
                                return n;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="ltr-iso font-bold">{c.entryNumber}</span> ·{' '}
                            <span className="ltr-iso">{isoToDayFirst(c.day)}</span> ·{' '}
                            {kindName(c.kind)}
                            {c.memo && (
                              <span className="block text-caption text-text-muted">{c.memo}</span>
                            )}
                          </span>
                          <Amount piastres={c.amountPiastres} />
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
                    <span
                      className={`text-body-sm ${pickedOk ? 'text-status-delivered' : 'text-text-muted'}`}
                    >
                      {t('pickedSum', {
                        sum: formatEgp(pickedSum),
                        left: formatEgp(line.amountPiastres - pickedSum),
                      })}
                    </span>
                    <button
                      type="button"
                      className={primary}
                      disabled={busy || !pickedOk}
                      onClick={() => void match([...picked])}
                    >
                      {t('matchPicked', { count: picked.size })}
                    </button>
                  </div>
                </details>
              )}

              {canWrite && (
                <div className="space-y-2 border-t border-line pt-3">
                  {line.amountPiastres < 0 && (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy}
                      onClick={() =>
                        void send(
                          `/finance/bank-lines/${line.id}/bank-charge`,
                          {},
                          t('chargeBooked'),
                        )
                      }
                    >
                      {t('bankCharge')}
                    </button>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('asideReason')}
                      aria-label={t('asideReason')}
                      className={`${field} min-w-0 flex-1 sm:max-w-sm`}
                    />
                    <button
                      type="button"
                      className={btn}
                      disabled={busy || note.trim().length < 5}
                      onClick={() =>
                        void send(
                          `/finance/bank-lines/${line.id}/ignore`,
                          { note },
                          t('setAsideDone'),
                        )
                      }
                    >
                      {t('setAside')}
                    </button>
                  </div>
                  <p className="text-caption text-text-muted">{t('neverCreates')}</p>
                </div>
              )}
              {message && (
                <p
                  role="status"
                  className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
                >
                  {message.text}
                </p>
              )}
              <p className="sr-only" lang={locale}>
                {t('keysHint')}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
