'use client';

import { exampleMonth, type ProposalFees, proposalApproval } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { formatCount, formatEgp } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import {
  bpText,
  egpInput,
  feeInput,
  isPercentFee,
  parseCount,
  parseFee,
  parseMoney,
  parseTiers,
  PROPOSAL_FEE_KEYS,
  type ProposalView,
  type TierInput,
  tierRows,
} from '@/lib/sales-part2';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * A proposal's rates and terms: every fee (from the fee settings), volume tiers, the example
 * month's volume, the monthly minimum, deposit, credit limit and the contract's start, length
 * and notice. Shows the discount against the settings as it is typed, and whether a sales
 * manager must approve before it can be sent.
 */
export function ProposalForm({
  dealId,
  proposal,
  defaults,
  maxDiscountBp,
  expectedOrders,
  onDone,
  onCancel,
}: {
  dealId: string;
  /** A draft to edit; a new proposal when left out */
  proposal?: ProposalView;
  defaults: ProposalFees;
  maxDiscountBp: number;
  expectedOrders: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('sales.proposals');
  const te = useTranslations('sales.errors');
  const fees = proposal?.fees ?? defaults;
  const start = {
    fees: Object.fromEntries(PROPOSAL_FEE_KEYS.map((k) => [k, feeInput(k, fees[k])])) as Record<
      keyof ProposalFees,
      string
    >,
    orders: String(proposal?.expectedMonthlyOrders ?? expectedOrders ?? ''),
    average: egpInput(proposal?.averageOrderPiastres ?? null),
    minimum: egpInput(proposal?.minimumMonthlyFeePiastres ?? null),
    deposit: egpInput(proposal?.securityDepositPiastres ?? null),
    credit: egpInput(proposal?.creditLimitPiastres ?? null),
    startDate: proposal?.contractStartDate ?? '',
    months: proposal?.contractMonths ? String(proposal.contractMonths) : '12',
    notice: String(proposal?.noticeDays ?? 30),
    terms: proposal?.terms ?? '',
    tiers: tierRows(proposal?.tiers ?? []),
  };
  const [v, setV] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newActionKey);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);

  // What the form holds, read as the API takes it (null: not valid yet).
  const parsed = (() => {
    const out = {} as ProposalFees;
    for (const k of PROPOSAL_FEE_KEYS) {
      const value = parseFee(k, v.fees[k]);
      if (value === null) return null;
      out[k] = value;
    }
    const tiers = parseTiers(v.tiers);
    const orders = parseCount(v.orders);
    const months = parseCount(v.months);
    const notice = parseCount(v.notice);
    const average = parseMoney(v.average);
    const minimum = parseMoney(v.minimum);
    const deposit = parseMoney(v.deposit);
    const credit = parseMoney(v.credit);
    if (!tiers || notice === null) return null;
    for (const x of [orders, months, notice, average, minimum, deposit, credit])
      if (Number.isNaN(x)) return null;
    if (months !== null && (months < 1 || months > 120)) return null;
    return {
      ...out,
      tiers,
      expectedMonthlyOrders: orders,
      averageOrderPiastres: average,
      minimumMonthlyFeePiastres: minimum,
      securityDepositPiastres: deposit,
      creditLimitPiastres: credit,
      contractStartDate: v.startDate || null,
      contractMonths: months,
      noticeDays: notice,
      terms: v.terms,
    };
  })();
  const approval = parsed ? proposalApproval(parsed, defaults, maxDiscountBp) : null;
  const example = parsed ? exampleMonth(parsed) : null;

  async function save() {
    if (!parsed) return setError(te('validation_failed'));
    setBusy(true);
    setError(null);
    const result = proposal
      ? await apiSend('PATCH', `/sales/proposals/${proposal.id}`, parsed)
      : await apiSend('POST', '/sales/proposals', { ...parsed, dealId, idempotencyKey: key });
    setBusy(false);
    if (!result.ok) return setError(te.has(result.error) ? te(result.error) : te('generic'));
    onDone();
  }

  const setFee = (k: keyof ProposalFees, text: string) =>
    setV({ ...v, fees: { ...v.fees, [k]: text } });
  const setTier = (i: number, patch: Partial<TierInput>) =>
    setV({ ...v, tiers: v.tiers.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <form
      className="mt-3 space-y-4 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 className="text-h3">
        {proposal ? t('editTitle', { label: proposal.label }) : t('newTitle')}
      </h3>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-body-sm font-bold">{t('rates')}</legend>
        {PROPOSAL_FEE_KEYS.map((k) => (
          <label key={k} className="text-body-sm">
            <span className="font-semibold">{t(`fees.${k}`)}</span>
            <span className="flex items-center gap-2">
              <input
                className={`${field} mt-1`}
                inputMode="decimal"
                dir="ltr"
                value={v.fees[k]}
                onChange={(e) => setFee(k, e.target.value)}
              />
              <span className="text-caption text-text-muted">
                {isPercentFee(k) ? '%' : t('egp')}
              </span>
            </span>
            <span className="text-caption text-text-muted">
              {t('listValue', {
                value: isPercentFee(k) ? `${bpText(defaults[k])}%` : formatEgp(defaults[k]),
              })}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend className="text-body-sm font-bold">{t('tiers')}</legend>
        <p className="text-caption text-text-muted">{t('tiersHint')}</p>
        <div className="mt-2 space-y-2">
          {v.tiers.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <label className="text-caption">
                {t('tierFrom')}
                <input
                  className={field}
                  inputMode="numeric"
                  dir="ltr"
                  value={r.fromOrder}
                  onChange={(e) => setTier(i, { fromOrder: e.target.value })}
                />
              </label>
              <label className="text-caption">
                {t('tierFixed')}
                <input
                  className={field}
                  inputMode="decimal"
                  dir="ltr"
                  value={r.fixed}
                  onChange={(e) => setTier(i, { fixed: e.target.value })}
                />
              </label>
              <label className="text-caption">
                {t('tierPercent')}
                <input
                  className={field}
                  inputMode="decimal"
                  dir="ltr"
                  value={r.percent}
                  onChange={(e) => setTier(i, { percent: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="h-10 rounded-md px-2 text-body-sm text-danger"
                onClick={() => setV({ ...v, tiers: v.tiers.filter((_, j) => j !== i) })}
              >
                {t('removeTier')}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary mt-2"
          onClick={() =>
            setV({ ...v, tiers: [...v.tiers, { fromOrder: '', fixed: '', percent: '' }] })
          }
        >
          {t('addTier')}
        </button>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-body-sm font-bold">{t('terms')}</legend>
        {(
          [
            ['orders', t('expectedOrders'), 'numeric'],
            ['average', t('averageOrder'), 'decimal'],
            ['minimum', t('minimum'), 'decimal'],
            ['deposit', t('deposit'), 'decimal'],
            ['credit', t('creditLimit'), 'decimal'],
            ['months', t('contractMonths'), 'numeric'],
            ['notice', t('noticeDays'), 'numeric'],
          ] as const
        ).map(([name, label, mode]) => (
          <label key={name} className="text-body-sm">
            <span className="font-semibold">{label}</span>
            <input
              className={`${field} mt-1`}
              inputMode={mode}
              dir="ltr"
              value={v[name]}
              onChange={(e) => setV({ ...v, [name]: e.target.value })}
            />
          </label>
        ))}
        <label className="text-body-sm">
          <span className="font-semibold">{t('contractStart')}</span>
          <DateInput
            value={v.startDate}
            onChange={(e) => setV({ ...v, startDate: e.target.value })}
            className="mt-1"
          />
          <span className="text-caption text-text-muted">{t('contractStartHint')}</span>
        </label>
        <label className="text-body-sm sm:col-span-2 lg:col-span-3">
          <span className="font-semibold">{t('termsText')}</span>
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-line-strong bg-surface p-3 text-body-sm"
            maxLength={4000}
            value={v.terms}
            onChange={(e) => setV({ ...v, terms: e.target.value })}
          />
        </label>
      </fieldset>

      {approval && (
        <p
          className={`rounded-md p-3 text-body-sm ${approval.needsApproval ? 'bg-status-needs-action/15 font-bold text-status-needs-action' : 'bg-surface-raised'}`}
        >
          {approval.needsApproval
            ? t('needsApproval', {
                discount: bpText(approval.maxDiscountBp),
                limit: bpText(maxDiscountBp),
              })
            : t('withinLimit', { limit: bpText(maxDiscountBp) })}
        </p>
      )}
      {example && example.orders > 0 && (
        <p className="text-body-sm">
          {t('exampleLine', {
            orders: formatCount(example.orders),
            total: formatEgp(example.totalPiastres),
            perOrder: example.perOrderPiastres === null ? '–' : formatEgp(example.perOrderPiastres),
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter dirty={dirty} busy={busy} onCancel={onCancel} />
    </form>
  );
}
