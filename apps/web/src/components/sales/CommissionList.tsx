'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { bpText, type CommissionLine, type CommissionRow, egpInput } from '@/lib/sales-part2';
import { parseEgp } from '@/lib/money';
import { OutcomePill } from './CommissionStanding';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';

/**
 * The merchants behind a commission: counted fees and the share each pays on a hit (`hit`
 * false: counted, nothing paid), then merchants still pending (their fees not counted).
 */
export function CommissionLines({ lines, hit }: { lines: CommissionLine[]; hit: boolean }) {
  const t = useTranslations('sales.commission');
  return (
    <ul className="mt-1 space-y-0.5 text-caption text-text-muted">
      {lines.map((l) => (
        <li key={l.dealId}>
          <Link href={`/admin/sales/deals/${l.dealId}`} className="text-link">
            {l.company}
          </Link>{' '}
          ·{' '}
          {!l.qualified
            ? t('linePending', {
                month: l.monthIndex,
                active: Math.min(l.activeMonths, l.qualifyMonths ?? l.activeMonths),
                needed: l.qualifyMonths ?? 0,
                fees: formatEgp(l.feesPiastres),
              })
            : hit
              ? t('lineText', {
                  month: l.monthIndex,
                  fees: formatEgp(l.feesPiastres),
                  rate: bpText(l.rateBp),
                  amount: formatEgp(l.amountPiastres),
                })
              : t('lineCounted', {
                  month: l.monthIndex,
                  fees: formatEgp(l.feesPiastres),
                  rate: bpText(l.rateBp),
                })}
        </li>
      ))}
    </ul>
  );
}

/** Approve or adjust a draft (sales managers, never their own). */
function Actions({ row, meId }: { row: CommissionRow; meId: string }) {
  const t = useTranslations('sales.commission');
  const te = useTranslations('sales.errors');
  const router = useRouter();
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState(egpInput(row.amountPiastres));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (row.status !== 'draft') return null;
  if (row.user.id === meId)
    return <span className="text-caption text-text-muted">{t('notYours')}</span>;
  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', path, body);
    setBusy(false);
    if (!result.ok) return setError(te.has(result.error) ? te(result.error) : te('generic'));
    setAdjusting(false);
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void send(`/sales/commissions/${row.id}/approve`, {})}
        >
          {t('approve')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => setAdjusting(!adjusting)}
        >
          {t('adjust')}
        </button>
      </div>
      {adjusting && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const piastres = parseEgp(amount);
            if (piastres === null) return setError(te('validation_failed'));
            void send(`/sales/commissions/${row.id}/adjust`, { amountPiastres: piastres, reason });
          }}
        >
          <input
            className="h-10 w-32 rounded-md border border-line-strong bg-surface px-2 text-body-sm"
            inputMode="decimal"
            dir="ltr"
            aria-label={t('amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm"
            placeholder={t('reason')}
            aria-label={t('reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={busy || reason.trim().length < 3}
          >
            {t('saveAdjust')}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Commission by month: drafts, approved and paid, with who and how it was paid. */
export function CommissionList({
  rows,
  meId,
  canManage,
}: {
  rows: CommissionRow[];
  meId: string;
  canManage: boolean;
}) {
  const t = useTranslations('sales.commission');
  const locale = useLocale();
  if (!rows.length) return <p className="mt-3 text-body-sm text-text-muted">{t('empty')}</p>;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>
            <th className={th}>{t('month')}</th>
            <th className={th}>{t('rep')}</th>
            <th className={th}>{t('result')}</th>
            <th className={`${th} text-end`}>{t('amount')}</th>
            <th className={th}>{t('status')}</th>
            {canManage && <th className={th}>{t('action')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className={td}>
                <span className="ltr-iso font-semibold">{r.month}</span>
                <CommissionLines lines={r.lines} hit={r.outcome === 'hit'} />
              </td>
              <td className={td}>{r.user.name}</td>
              <td className={td}>
                <OutcomePill outcome={r.outcome} />
                <span className="mt-1 block text-caption text-text-muted">
                  {t('countedOf', {
                    revenue: formatEgp(r.revenuePiastres),
                    target: r.targetPiastres ? formatEgp(r.targetPiastres) : t('noTargetShort'),
                  })}
                </span>
              </td>
              <td className={`${td} text-end`}>
                <span className="tabular font-bold">{formatEgp(r.amountPiastres)}</span>
                {r.amountPiastres !== r.computedPiastres && (
                  <span className="block text-caption text-text-muted">
                    {t('adjusted', {
                      computed: formatEgp(r.computedPiastres),
                      name: r.adjustedBy ?? '',
                      reason: r.adjustReason ?? '',
                    })}
                  </span>
                )}
              </td>
              <td className={td}>
                <span
                  className={`rounded-pill border border-line px-2.5 py-0.5 text-caption ${r.status === 'paid' ? 'text-success' : r.status === 'approved' ? 'text-link' : 'text-text-muted'}`}
                >
                  {t(`statuses.${r.status}`)}
                </span>
                {r.approvedBy && r.approvedAt && (
                  <span className="mt-1 block text-caption text-text-muted">
                    {t('approvedBy', {
                      name: r.approvedBy,
                      when: formatCairoDateTime(r.approvedAt, locale),
                    })}
                  </span>
                )}
                {r.paidVia && (
                  <span className="mt-1 block text-caption text-text-muted">
                    {r.paidVia === 'payroll' ? t('paidPayroll') : t('paidBonus')}
                  </span>
                )}
              </td>
              {canManage && (
                <td className={td}>
                  <Actions row={r} meId={meId} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
