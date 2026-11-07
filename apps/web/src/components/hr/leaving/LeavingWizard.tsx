'use client';

import { EXIT_REASONS, type ExitReason } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import {
  candidatesFor,
  type ExitView,
  LEAVING_STEPS,
  leavingDayIssues,
  type LeavingPreview,
  type LeavingStep,
} from '@/lib/hr-phase2';

const box =
  'mt-1 block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
const primary =
  'inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-body-sm font-bold text-on-primary disabled:opacity-50';
const secondary =
  'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text disabled:opacity-50';

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `leave-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The leaving wizard (HR phase 2, HR manage): the last working day and reason with the notice
 * check, company items returned, the final settlement figures for payroll (money with the
 * salaries switch), who takes over what the person looked after, and a review. Confirming sets
 * the file to left; the account closes at the end of the last day.
 */
export function LeavingWizard({ initial, today }: { initial: LeavingPreview; today: string }) {
  const t = useTranslations('hr2');
  const locale = useLocale();
  const [step, setStep] = useState<LeavingStep>('day');
  const [preview, setPreview] = useState(initial);
  const [lastDay, setLastDay] = useState(initial.lastDay);
  const [reason, setReason] = useState<ExitReason | ''>('');
  const [note, setNote] = useState('');
  const [noticeGivenOn, setNoticeGivenOn] = useState('');
  const [returned, setReturned] = useState<string[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ExitView | null>(null);
  const key = useRef(newKey());
  const top = useRef<HTMLDivElement>(null);
  const e = preview.employee;
  const at = LEAVING_STEPS.indexOf(step);
  const progress = Math.round((at / (LEAVING_STEPS.length - 1)) * 100);
  const title = (x: { titleEn: string; titleAr: string }) =>
    locale === 'ar' ? x.titleAr : x.titleEn;
  const fail = (code: string) =>
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  function go(next: LeavingStep) {
    setStep(next);
    setError(null);
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function next() {
    if (step === 'day') {
      const found = leavingDayIssues({ lastDay, reason, note, noticeGivenOn });
      setIssues(found);
      if (found.length > 0) return;
      setBusy(true);
      const q = new URLSearchParams({ lastDay });
      if (noticeGivenOn) q.set('noticeGivenOn', noticeGivenOn);
      const r = await apiGetClient<LeavingPreview>(`/hr/employees/${e.id}/leaving?${q.toString()}`);
      setBusy(false);
      if (!r.ok) return fail(r.error);
      setPreview(r.data);
      const b = r.data.blockers;
      if (b.alreadyLeft) return fail('employee_left');
      if (b.self) return fail('cannot_leave_self');
      if (b.beforeHire) return fail('left_before_hire');
      if (b.lastOwner) return fail('last_owner');
    }
    go(LEAVING_STEPS[at + 1]!);
  }

  async function confirm() {
    if (!window.confirm(t('leaving.confirmQuestion'))) return;
    setBusy(true);
    setError(null);
    const res = await apiSend<ExitView>('POST', `/hr/employees/${e.id}/leaving`, {
      lastDay,
      reason,
      ...(note.trim() && { note: note.trim() }),
      ...(noticeGivenOn && { noticeGivenOn }),
      itemsReturned: returned,
      replacements: preview.owned.map((o) => ({
        kind: o.kind,
        entityId: o.entityId,
        newOwnerId: owners[`${o.kind}:${o.entityId}`] || null,
      })),
      idempotencyKey: key.current,
    });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    setDone(res.data);
  }

  if (done) {
    const open = done.reassignments.filter((r) => !r.resolvedAt).length;
    return (
      <section
        className="mt-4 max-w-2xl rounded-lg border border-status-delivered bg-surface p-4"
        aria-live="polite"
      >
        <h2 className="text-h3">{t('leaving.doneTitle', { name: e.nameEn })}</h2>
        <p className="mt-2 text-body-sm">
          {done.disabledAt
            ? t('leaving.closedNow')
            : t('leaving.closesOn', { date: isoToDayFirst(done.lastDay) })}
        </p>
        <p className="mt-1 text-body-sm">{t('leaving.offboardingStarted')}</p>
        {open > 0 && (
          <p className="mt-1 text-body-sm font-bold">{t('leaving.stillOpen', { count: open })}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/admin/hr/${e.id}?tab=checklists`} className={primary}>
            {t('leaving.openFile')}
          </Link>
          {open > 0 && (
            <Link href="/admin/hr/needs-owner" className={secondary}>
              {t('leaving.openNeedsOwner')}
            </Link>
          )}
        </div>
      </section>
    );
  }

  const s = preview.settlement;
  const money = (v: number | null) =>
    v === null ? '–' : <span className="ltr-iso">{formatEgp(v)}</span>;
  const figures: [string, ReactNode, ReactNode][] = [
    [
      t('settle.daysWorked', { from: isoToDayFirst(s.from) }),
      s.daysWorked,
      money(s.lastMonthPayPiastres),
    ],
    [t('settle.leaveToPay'), s.leaveDaysToPay, money(s.leavePayPiastres)],
    ...(s.leaveDaysAhead > 0
      ? ([[t('settle.leaveAhead'), s.leaveDaysAhead, money(s.leaveAheadPiastres)]] as [
          string,
          ReactNode,
          ReactNode,
        ][])
      : []),
    [t('settle.unpaid'), s.unpaidLeaveDays, money(s.unpaidLeavePiastres)],
    [
      t('settle.deductions', { count: s.deductionCount }),
      s.deductionDays || '–',
      money(s.deductionsPiastres),
    ],
    [t('settle.advance'), '–', money(s.advancePiastres)],
    [t('settle.commission'), '–', money(s.commissionPiastres)],
  ];

  return (
    <div ref={top} className="mt-4 max-w-4xl scroll-mt-20">
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-caption text-text-muted">
          {t('stepOf', { n: at + 1, total: LEAVING_STEPS.length })} ·{' '}
          <span className="font-bold text-text">{t(`leaving.steps.${step}`)}</span>
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-raised"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('progress')}
        >
          <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <section
        className="mt-4 rounded-lg border border-line bg-surface p-4"
        aria-labelledby="leave-step"
      >
        <h2 id="leave-step" className="text-h3">
          {t(`leaving.steps.${step}`)}
        </h2>
        <p className="mt-1 text-body-sm text-text-muted">{t(`leaving.intros.${step}`)}</p>

        {step === 'day' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block min-w-0 text-caption font-bold">
              {t('leaving.lastDay')} <span className="text-danger">*</span>
              <span className="mt-1 block">
                <DateInput
                  value={lastDay}
                  onChange={(ev) => setLastDay(ev.target.value)}
                  className="h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text"
                />
              </span>
              {issues.includes('lastDay') && (
                <span role="alert" className="mt-1 block text-danger">
                  {t('issues.invalid_date')}
                </span>
              )}
            </label>
            <fieldset className="min-w-0 sm:col-span-2">
              <legend className="text-caption font-bold">
                {t('leaving.reason')} <span className="text-danger">*</span>
              </legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {EXIT_REASONS.map((r) => (
                  <label
                    key={r}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
                      reason === r ? 'border-primary font-bold' : 'border-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reason"
                      checked={reason === r}
                      onChange={() => setReason(r)}
                    />
                    {t(`leaving.reasons.${r}`)}
                  </label>
                ))}
              </div>
              {issues.includes('reason') && (
                <p role="alert" className="mt-1 text-caption font-bold text-danger">
                  {t('issues.required')}
                </p>
              )}
            </fieldset>
            <label className="block min-w-0 text-caption font-bold sm:col-span-2">
              {t('leaving.note')}
              {reason === 'other' && <span className="text-danger"> *</span>}
              <input
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                maxLength={300}
                className={box}
              />
              {issues.includes('note') && (
                <span role="alert" className="mt-1 block text-danger">
                  {t('issues.required')}
                </span>
              )}
            </label>
            <label className="block min-w-0 text-caption font-bold">
              {t('leaving.noticeGivenOn')}
              <span className="mt-1 block">
                <DateInput
                  value={noticeGivenOn}
                  onChange={(ev) => setNoticeGivenOn(ev.target.value)}
                  className="h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text"
                />
              </span>
              {issues.includes('noticeAfter') && (
                <span role="alert" className="mt-1 block text-danger">
                  {t('leaving.noticeAfter')}
                </span>
              )}
            </label>
            <div className="min-w-0 rounded-md border border-line bg-surface-raised p-3 text-body-sm">
              <p className="font-bold">{t('leaving.noticeTitle', { days: preview.notice.days })}</p>
              <p className="mt-1">
                {!noticeGivenOn
                  ? t('leaving.noticeNone')
                  : preview.notice.shortBy > 0 && preview.lastDay === lastDay
                    ? t('leaving.noticeShort', {
                        given: preview.notice.givenDays ?? 0,
                        short: preview.notice.shortBy,
                      })
                    : preview.lastDay === lastDay
                      ? t('leaving.noticeOk', { given: preview.notice.givenDays ?? 0 })
                      : t('leaving.noticeAfterNext')}
              </p>
            </div>
          </div>
        )}

        {step === 'items' && (
          <div className="mt-4">
            {preview.items.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('leaving.noItems')}</p>
            ) : (
              <ul className="space-y-2">
                {preview.items.map((i) => {
                  const on = returned.includes(i.titleEn);
                  return (
                    <li key={i.titleEn}>
                      <label
                        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-body-sm ${
                          on ? 'border-status-delivered' : 'border-line'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setReturned(
                              on
                                ? returned.filter((x) => x !== i.titleEn)
                                : [...returned, i.titleEn],
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="block font-bold">{title(i)}</span>
                          <span className="block text-caption text-text-muted">
                            {t(`leaving.owners.${i.ownerRole}`)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-caption text-text-muted">{t('leaving.itemsHint')}</p>
          </div>
        )}

        {step === 'settlement' && (
          <div className="mt-4">
            {e.employment === 'outsourced' && (
              <p className="mb-3 rounded-md border border-line bg-surface-raised p-3 text-body-sm">
                {t('settle.outsourced')}
              </p>
            )}
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full table-fixed text-body-sm">
                <thead className="bg-surface-raised">
                  <tr>
                    <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                      {t('settle.item')}
                    </th>
                    <th className="w-20 px-3 py-2 text-end text-label uppercase text-text-muted">
                      {t('settle.days')}
                    </th>
                    <th className="w-32 px-3 py-2 text-end text-label uppercase text-text-muted">
                      {t('settle.amount')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {figures.map(([label, days, amount]) => (
                    <tr key={label}>
                      <td className="px-3 py-2">{label}</td>
                      <td className="ltr-iso px-3 py-2 text-end">{days}</td>
                      <td className="px-3 py-2 text-end">{amount}</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="px-3 py-2">{t('settle.net')}</td>
                    <td />
                    <td className="px-3 py-2 text-end">{money(s.netPiastres)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-caption text-text-muted">
              {s.money ? t('settle.hint') : t('settle.noMoney')}
            </p>
          </div>
        )}

        {step === 'owners' && (
          <div className="mt-4">
            {preview.owned.length === 0 ? (
              <p className="text-body-sm text-text-muted">{t('leaving.nothingOwned')}</p>
            ) : (
              <ul className="space-y-3">
                {preview.owned.map((o) => {
                  const k = `${o.kind}:${o.entityId}`;
                  return (
                    <li
                      key={k}
                      className="grid min-w-0 gap-2 rounded-md border border-line p-3 sm:grid-cols-2 sm:items-center"
                    >
                      <span className="min-w-0">
                        <span className="block text-caption text-text-muted">
                          {t(`kinds.${o.kind}`)}
                        </span>
                        <span className="block truncate font-bold">
                          {locale === 'ar' ? o.labelAr : o.label}
                        </span>
                      </span>
                      <select
                        aria-label={t('leaving.newOwner')}
                        value={owners[k] ?? ''}
                        onChange={(ev) => setOwners({ ...owners, [k]: ev.target.value })}
                        className={`${box} mt-0`}
                      >
                        <option value="">{t('leaving.later')}</option>
                        {candidatesFor(o.kind, preview.candidates, o.entityId).map((c) => (
                          <option key={c.id} value={c.id}>
                            {locale === 'ar' ? c.labelAr : c.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-caption text-text-muted">{t('leaving.ownersHint')}</p>
          </div>
        )}

        {step === 'review' && (
          <dl className="mt-4 grid gap-x-6 sm:grid-cols-2">
            {(
              [
                [
                  t('leaving.person'),
                  `${locale === 'ar' && e.nameAr ? e.nameAr : e.nameEn} (${e.code})`,
                ],
                [
                  t('leaving.lastDay'),
                  <span key="d" className="ltr-iso">
                    {isoToDayFirst(lastDay)}
                  </span>,
                ],
                [t('leaving.reason'), reason ? t(`leaving.reasons.${reason}`) : '–'],
                [t('leaving.note'), note || '–'],
                [
                  t('leaving.notice'),
                  noticeGivenOn
                    ? preview.notice.shortBy > 0
                      ? t('leaving.noticeShortShort', { short: preview.notice.shortBy })
                      : t('leaving.noticeEnough')
                    : t('leaving.noticeNone'),
                ],
                [t('leaving.itemsReturned'), `${returned.length}/${preview.items.length}`],
                [
                  t('leaving.handedOver'),
                  `${Object.values(owners).filter(Boolean).length}/${preview.owned.length}`,
                ],
                [t('settle.net'), money(s.netPiastres)],
              ] as [string, ReactNode][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-3 border-b border-line py-2 text-body-sm"
              >
                <dt className="text-text-muted">{label}</dt>
                <dd className="min-w-0 text-end font-bold">{value}</dd>
              </div>
            ))}
            <p className="mt-3 text-body-sm sm:col-span-2">
              {t('leaving.reviewHint', { date: isoToDayFirst(lastDay) })}
            </p>
            {lastDay < today && (
              <p className="text-body-sm font-bold sm:col-span-2">{t('leaving.pastDay')}</p>
            )}
          </dl>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger p-3 text-body-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-line bg-bg px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        {at > 0 && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => go(LEAVING_STEPS[at - 1]!)}
          >
            {t('back')}
          </button>
        )}
        {step !== 'review' ? (
          <button type="button" className={primary} disabled={busy} onClick={() => void next()}>
            {t('next')}
          </button>
        ) : (
          <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
            {busy ? t('creating') : t('leaving.confirm')}
          </button>
        )}
        <Link href={`/admin/hr/${e.id}`} className="ms-auto text-body-sm font-bold text-link">
          {t('leaving.cancel')}
        </Link>
      </div>
    </div>
  );
}
