'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import type { BookAccount } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { PAY_STEPS, type PayRunData, type PayStep } from '@/lib/pay-run';
import { Amount } from './Amount';
import { ProofUpload } from './ProofUpload';

// The guided Pay merchants run (Accounting UX phase B): who is due today, review, approve,
// the bank's bulk file, mark paid (each payout with its own proof of transfer and checks), and
// what was done. Where it stands is
// read from the payouts themselves, so it can be left and picked up again.

const primary =
  'inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50';
const secondary =
  'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 font-bold hover:bg-surface-raised disabled:opacity-50';
const field = 'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Flag({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span
      className={`inline-block rounded-pill px-2 py-0.5 text-caption font-bold ${ok ? 'bg-selected-bg text-link' : 'bg-surface-raised text-danger'}`}
    >
      {ok ? yes : no}
    </span>
  );
}

export function PayMerchantsRun({
  run,
  step,
  banks,
  canWrite,
  canApprove,
}: {
  run: PayRunData;
  step: PayStep;
  banks: BookAccount[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const t = useTranslations('finance.payRun');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const toApprove = run.drafts.filter((d) => d.needsApproval && !d.approved);
  const ready = run.drafts.filter((d) => d.ready);
  const [approveIds, setApproveIds] = useState<Set<string>>(
    new Set(toApprove.filter((d) => !d.mine).map((d) => d.id)),
  );
  const [payIds, setPayIds] = useState<Set<string>>(new Set(ready.map((d) => d.id)));
  const [reference, setReference] = useState('');
  const [day, setDay] = useState(run.today);
  const cib = banks.find((b) => b.code === '1101') ?? banks[0];
  const [bank, setBank] = useState(cib?.id ?? '');

  const goStep = (s: PayStep) => {
    const next = new URLSearchParams(params.toString());
    next.set('step', s);
    setMessage(null);
    startTransition(() => router.push(`${pathname}?${next}`, { scroll: false }));
  };
  const errorText = (code: string) =>
    t.has(`errors.${code}`)
      ? t(`errors.${code}`)
      : tf.has(`merchants.errors.${code}`)
        ? tf(`merchants.errors.${code}`)
        : tf('merchants.errors.generic');

  async function post<T>(path: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    const r = await apiSend<T>('POST', path, body);
    setBusy(false);
    if (!r.ok) {
      setMessage({ text: errorText(r.error), error: true });
      return null;
    }
    return r.data;
  }

  const index = PAY_STEPS.indexOf(step);
  const stepper = (
    <ol className="flex flex-wrap gap-2" aria-label={t('stepsLabel')}>
      {PAY_STEPS.map((s, i) => {
        const on = s === step;
        const finished = run.done[s] && s !== 'done';
        return (
          <li key={s}>
            <button
              type="button"
              aria-current={on ? 'step' : undefined}
              onClick={() => goStep(s)}
              className={`flex h-10 items-center gap-2 rounded-pill border px-3 text-body-sm font-semibold ${on ? 'border-primary bg-selected-bg text-link' : 'border-line bg-surface'}`}
            >
              <span
                aria-hidden
                className={`flex h-6 w-6 items-center justify-center rounded-pill text-caption font-bold ${finished ? 'bg-status-delivered text-white' : on ? 'bg-primary text-on-primary' : 'bg-surface-raised'}`}
              >
                {finished ? '✓' : i + 1}
              </span>
              {t(`steps.${s}`)}
            </button>
          </li>
        );
      })}
    </ol>
  );

  const next = index < PAY_STEPS.length - 1 ? PAY_STEPS[index + 1]! : null;
  const nav = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      {index > 0 ? (
        <button type="button" className={secondary} onClick={() => goStep(PAY_STEPS[index - 1]!)}>
          {t('back')}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" className={secondary} onClick={() => goStep(next)}>
          {t('next')}
        </button>
      )}
    </div>
  );

  let body: ReactNode = null;
  if (step === 'prepare') {
    const readyDue = run.due.filter((d) => d.state === 'ready');
    body = (
      <>
        <p className="text-body-sm text-text-muted">{t('prepareIntro')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption">
            {t('cutoff')}
            <DateInput
              value={run.cutoffDay}
              max={run.today}
              onChange={(e) => {
                const n = new URLSearchParams(params.toString());
                n.set('cutoff', e.target.value);
                startTransition(() => router.push(`${pathname}?${n}`, { scroll: false }));
              }}
              className={field}
            />
          </label>
          {canWrite && (
            <button
              type="button"
              className={primary}
              disabled={busy || readyDue.length === 0}
              onClick={async () => {
                const r = await post<{ created: unknown[]; skipped: { reason: string }[] }>(
                  '/finance/payouts/due',
                  { cutoffDay: run.cutoffDay },
                );
                if (!r) return;
                setMessage({
                  text: t('prepared', {
                    created: r.created.length,
                    skipped: r.skipped.filter((s) => s.reason !== 'not_due_today').length,
                  }),
                  error: false,
                });
                router.refresh();
              }}
            >
              {t('prepareButton', { count: readyDue.length })}
            </button>
          )}
        </div>
        {run.due.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-body-sm text-text-muted">
            {t('nobodyDue')}
          </p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t('merchant')}</th>
                <th className={th}>{t('schedule')}</th>
                <th className={`${th} text-end`}>{t('owed')}</th>
                <th className={`${th} text-end`}>{t('minimum')}</th>
                <th className={th}>{t('bank')}</th>
                <th className={th}>{t('state')}</th>
              </>
            }
          >
            {run.due.map((d) => (
              <tr key={d.merchantId} className="border-t border-line">
                <td className={td}>
                  <Link href={`/finance/merchants/${d.merchantId}`} className="text-link">
                    {d.name}
                  </Link>
                </td>
                <td className={td}>{t(`schedules.${d.schedule}`)}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={d.owedPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={d.minimumPiastres} />
                </td>
                <td className={td}>
                  <Flag ok={d.bankDetails} yes={t('bankOk')} no={t('bankMissing')} />
                </td>
                <td className={td}>{t(`states.${d.state}`)}</td>
              </tr>
            ))}
          </Table>
        )}
      </>
    );
  } else if (step === 'review') {
    body = (
      <>
        <p className="text-body-sm text-text-muted">{t('reviewIntro')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t('draftsTotal', { count: run.drafts.length })}>
            <Amount piastres={run.totals.draftsPiastres} />
          </Stat>
          <Stat label={t('toApproveCount')}>{run.totals.toApprove}</Stat>
          <Stat label={t('missingBankCount')}>
            <span className={run.totals.missingBank ? 'text-danger' : ''}>
              {run.totals.missingBank}
            </span>
          </Stat>
        </div>
        <DraftTable run={run} t={t} />
      </>
    );
  } else if (step === 'approve') {
    const notNeeded = run.drafts.filter((d) => !d.needsApproval);
    body = (
      <>
        <p className="text-body-sm text-text-muted">
          {t('approveIntro', { limit: (run.limitPiastres / 100).toFixed(2) })}
        </p>
        {toApprove.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-body-sm text-text-muted">
            {t('nothingToApprove')}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {toApprove.map((d) => (
              <li key={d.id}>
                <label className="flex flex-wrap items-center gap-3 px-3 py-2 text-body-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={d.mine || !canApprove}
                    checked={approveIds.has(d.id)}
                    onChange={() =>
                      setApproveIds((s) => {
                        const n = new Set(s);
                        if (n.has(d.id)) n.delete(d.id);
                        else n.add(d.id);
                        return n;
                      })
                    }
                  />
                  <span className="ltr-iso font-bold">{d.number}</span>
                  <span className="min-w-0 flex-1">{d.merchant}</span>
                  <Amount piastres={d.amountPiastres} strong />
                  {d.mine && (
                    <span className="w-full text-caption text-text-muted">{t('yourOwn')}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {canApprove ? (
          toApprove.length > 0 && (
            <button
              type="button"
              className={primary}
              disabled={busy || approveIds.size === 0}
              onClick={async () => {
                const r = await post<{ results: { id: string; ok: boolean; error?: string }[] }>(
                  '/finance/payouts/bulk-approve',
                  { ids: [...approveIds] },
                );
                if (!r) return;
                const refused = r.results.filter((x) => !x.ok);
                setMessage({
                  text: t('approved', {
                    ok: r.results.length - refused.length,
                    refused: refused.length,
                  }),
                  error: refused.length > 0,
                });
                router.refresh();
              }}
            >
              {t('approveButton', { count: approveIds.size })}
            </button>
          )
        ) : (
          <p className="text-body-sm text-text-muted">{t('cannotApprove')}</p>
        )}
        {notNeeded.length > 0 && (
          <p className="text-body-sm text-text-muted">
            {t('notNeeded', { count: notNeeded.length })}
          </p>
        )}
      </>
    );
  } else if (step === 'file') {
    const blocked = run.drafts.filter((d) => !d.ready);
    body = (
      <>
        <p className="text-body-sm text-text-muted">{t('fileIntro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={t('readyCount', { count: run.totals.readyCount })}>
            <Amount piastres={run.totals.readyPiastres} />
          </Stat>
          <Stat label={t('blockedCount')}>{blocked.length}</Stat>
        </div>
        <a
          href="/api/finance/payouts/bank-file.csv"
          className={`${primary} ${run.totals.readyCount === 0 ? 'pointer-events-none opacity-50' : ''}`}
          aria-disabled={run.totals.readyCount === 0}
        >
          {t('download')}
        </a>
        {blocked.length > 0 && (
          <ul className="space-y-1 text-body-sm">
            {blocked.map((d) => (
              <li key={d.id}>
                <span className="ltr-iso font-bold">{d.number}</span> · {d.merchant} ·{' '}
                <span className="text-danger">
                  {!d.bankDetails ? t('bankMissing') : t('waitsApproval')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (step === 'pay') {
    const total = ready.filter((d) => payIds.has(d.id)).reduce((s, d) => s + d.amountPiastres, 0);
    body = (
      <>
        <p className="text-body-sm text-text-muted">{t('payIntroProof')}</p>
        {ready.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-body-sm text-text-muted">
            {t('nothingToPay')}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {ready.map((d) => (
                <li key={d.id} className="space-y-2 px-3 py-2">
                  <label className="flex flex-wrap items-center gap-3 text-body-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={payIds.has(d.id)}
                      onChange={() =>
                        setPayIds((s) => {
                          const n = new Set(s);
                          if (n.has(d.id)) n.delete(d.id);
                          else n.add(d.id);
                          return n;
                        })
                      }
                    />
                    <span className="ltr-iso font-bold">{d.number}</span>
                    <span className="min-w-0 flex-1">{d.merchant}</span>
                    <Amount piastres={d.amountPiastres} strong />
                  </label>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ps-7 text-caption">
                    <span className={d.proof ? '' : 'text-danger'}>
                      {t('proof')}:{' '}
                      {d.proof ? (
                        <span className="ltr-iso">
                          {d.proof.number} · {d.proof.reference}
                        </span>
                      ) : (
                        t('noProof')
                      )}
                    </span>
                    <span
                      className={d.checksDone < d.checksTotal ? 'text-danger' : 'text-text-muted'}
                    >
                      {t('checksCount', { done: d.checksDone, total: d.checksTotal })}
                    </span>
                    <Link href={`/finance/payouts/${d.id}#payout-controls`} className="text-link">
                      {t('openPayout')}
                    </Link>
                    {d.viewedByMe && <span className="text-text-muted">{t('viewedByMe')}</span>}
                  </div>
                  {canWrite && !d.proof && (
                    <details className="ps-7">
                      <summary className="cursor-pointer text-body-sm font-bold text-link">
                        {t('uploadProof')}
                      </summary>
                      <div className="pt-2">
                        <ProofUpload payoutId={d.id} amountPiastres={d.amountPiastres} compact />
                      </div>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-caption">
                {t('reference')}
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={t('referenceOptional')}
                  dir="ltr"
                  className={field}
                />
              </label>
              <label className="text-caption">
                {t('paidOn')}
                <DateInput
                  value={day}
                  max={run.today}
                  onChange={(e) => setDay(e.target.value)}
                  className={field}
                />
              </label>
              <label className="text-caption">
                {t('fromBank')}
                <select value={bank} onChange={(e) => setBank(e.target.value)} className={field}>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {locale === 'ar' ? b.nameAr || b.nameEn : b.nameEn}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {canWrite && (
              <button
                type="button"
                className={primary}
                disabled={busy || payIds.size === 0 || reference.trim().length === 1}
                onClick={async () => {
                  const r = await post<{ results: { id: string; ok: boolean; error?: string }[] }>(
                    '/finance/payouts/run/mark-paid',
                    {
                      ids: [...payIds],
                      reference: reference.trim() || undefined,
                      day: day && day !== cairoDay(new Date()) ? day : undefined,
                      bankAccountId: bank || undefined,
                    },
                  );
                  if (!r) return;
                  const refused = r.results.filter((x) => !x.ok);
                  if (refused.length)
                    setMessage({
                      text: t('paidSome', {
                        ok: r.results.length - refused.length,
                        refused: refused.length,
                        reason:
                          refused[0]!.error === 'same_person'
                            ? t('paySamePerson')
                            : errorText(refused[0]!.error ?? 'generic'),
                      }),
                      error: true,
                    });
                  router.refresh();
                  if (!refused.length) goStep('done');
                }}
              >
                {t('payButton', { count: payIds.size, amount: (total / 100).toFixed(2) })}
              </button>
            )}
          </>
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="text-body-sm text-text-muted">{t('doneIntro')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t('paidToday', { count: run.paid.length })}>
            <Amount piastres={run.totals.paidPiastres} />
          </Stat>
          <Stat label={t('emailsQueued')}>{run.totals.emailsQueued}</Stat>
          <Stat label={t('stillDrafts')}>{run.drafts.length}</Stat>
        </div>
        {run.paid.length > 0 && (
          <Table
            head={
              <>
                <th className={th}>{t('number')}</th>
                <th className={th}>{t('merchant')}</th>
                <th className={th}>{t('reference')}</th>
                <th className={th}>{t('paidAt')}</th>
                <th className={`${th} text-end`}>{t('emails')}</th>
                <th className={`${th} text-end`}>{t('amount')}</th>
              </>
            }
          >
            {run.paid.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className={td}>
                  <Link href={`/finance/payouts/${p.id}`} className="ltr-iso font-bold text-link">
                    {p.number}
                  </Link>
                </td>
                <td className={td}>{p.merchant}</td>
                <td className={`${td} ltr-iso`}>{p.reference}</td>
                <td className={`${td} ltr-iso`}>{formatCairoDateTime(p.paidAt, locale)}</td>
                <td className={`${td} text-end`}>{p.emails}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.amountPiastres} strong />
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex flex-wrap gap-3 text-body-sm font-bold">
          <Link href="/finance/payouts?f=paid" className="text-link">
            {t('allPayouts')}
          </Link>
          <Link href="/finance/emails" className="text-link">
            {t('emailsLink')}
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className={`mt-4 space-y-4 ${pending ? 'opacity-70' : ''}`}>
      <p className="text-body-sm">
        {t('today', { day: isoToDayFirst(run.today), cutoff: isoToDayFirst(run.cutoffDay) })}
      </p>
      {stepper}
      <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">
          {index + 1}. {t(`steps.${step}`)}
        </h2>
        {body}
        {message && (
          <p
            role="status"
            className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
          >
            {message.text}
          </p>
        )}
        {nav}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-3">
      <p className="text-label uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-h3">{children}</p>
    </div>
  );
}

function DraftTable({ run, t }: { run: PayRunData; t: ReturnType<typeof useTranslations> }) {
  if (run.drafts.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-body-sm text-text-muted">
        {t('noDrafts')}
      </p>
    );
  return (
    <Table
      head={
        <>
          <th className={th}>{t('number')}</th>
          <th className={th}>{t('merchant')}</th>
          <th className={th}>{t('bank')}</th>
          <th className={th}>{t('approval')}</th>
          <th className={`${th} text-end`}>{t('amount')}</th>
        </>
      }
    >
      {run.drafts.map((d) => (
        <tr key={d.id} className="border-t border-line">
          <td className={td}>
            <Link href={`/finance/payouts/${d.id}`} className="ltr-iso font-bold text-link">
              {d.number}
            </Link>
          </td>
          <td className={td}>{d.merchant}</td>
          <td className={td}>
            {d.bankDetails ? (
              <Flag ok yes={t('bankOk')} no="" />
            ) : (
              <Link href={`/finance/merchants/${d.merchantId}`} className="text-danger underline">
                {t('bankMissing')}
              </Link>
            )}
          </td>
          <td className={td}>
            {!d.needsApproval
              ? t('notNeededShort')
              : d.approved
                ? t('approvedBy', { name: d.approvedBy ?? '' })
                : t('waitsApproval')}
          </td>
          <td className={`${td} text-end`}>
            <Amount piastres={d.amountPiastres} strong />
          </td>
        </tr>
      ))}
    </Table>
  );
}
