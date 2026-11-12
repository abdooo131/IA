'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCount, formatEgp } from '@/lib/format';
import { bpText, egpInput, parseCount, parseMoney, type TargetRow } from '@/lib/sales-part2';
import { CommissionCell } from './CommissionStanding';

const box = 'h-10 w-28 rounded-md border border-line-strong bg-surface px-2 text-body-sm';

/** One rep's figures against their targets; a sales manager edits the targets in place. */
function Row({
  row,
  month,
  running,
  canEdit,
}: {
  row: TargetRow;
  month: string;
  running: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('sales.targets');
  const te = useTranslations('sales.errors');
  const router = useRouter();
  const start = {
    deals: row.target ? String(row.target.dealsWon) : '',
    orders: row.target ? String(row.target.orders) : '',
    revenue: row.target ? egpInput(row.target.feeRevenuePiastres) : '',
  };
  const [v, setV] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);

  async function save() {
    const deals = parseCount(v.deals);
    const orders = parseCount(v.orders);
    const revenue = parseMoney(v.revenue);
    if ([deals, orders, revenue].some((x) => x === null || Number.isNaN(x)))
      return setError(te('validation_failed'));
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', '/sales/targets', {
      userId: row.user.id,
      month,
      dealsWon: deals,
      orders,
      feeRevenuePiastres: revenue,
    });
    setBusy(false);
    if (!result.ok) return setError(te.has(result.error) ? te(result.error) : te('generic'));
    setSaved(true);
    router.refresh();
  }

  const cell = (actual: string, target: string | null, bp: number | null) => (
    <div>
      <span className="tabular ltr-iso font-bold">{actual}</span>
      <span className="text-caption text-text-muted">
        {' '}
        / <span className="ltr-iso">{target ?? '–'}</span>
        {bp !== null && <span className="ltr-iso"> · {bpText(bp)}%</span>}
      </span>
    </div>
  );
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2 font-semibold">{row.user.name}</td>
      <td className="px-3 py-2">
        {cell(
          formatCount(row.actual.dealsWon),
          row.target ? formatCount(row.target.dealsWon) : null,
          row.progress.dealsWon,
        )}
        {canEdit && (
          <input
            className={`${box} mt-1`}
            inputMode="numeric"
            dir="ltr"
            aria-label={t('dealsTarget', { name: row.user.name })}
            value={v.deals}
            onChange={(e) => setV({ ...v, deals: e.target.value })}
          />
        )}
      </td>
      <td className="px-3 py-2">
        {cell(
          formatCount(row.actual.orders),
          row.target ? formatCount(row.target.orders) : null,
          row.progress.orders,
        )}
        {canEdit && (
          <input
            className={`${box} mt-1`}
            inputMode="numeric"
            dir="ltr"
            aria-label={t('ordersTarget', { name: row.user.name })}
            value={v.orders}
            onChange={(e) => setV({ ...v, orders: e.target.value })}
          />
        )}
      </td>
      <td className="px-3 py-2">
        {cell(
          formatEgp(row.actual.feeRevenuePiastres),
          row.target ? formatEgp(row.target.feeRevenuePiastres) : null,
          row.progress.feeRevenue,
        )}
        {canEdit && (
          <input
            className={`${box} mt-1`}
            inputMode="decimal"
            dir="ltr"
            aria-label={t('revenueTarget', { name: row.user.name })}
            value={v.revenue}
            onChange={(e) => setV({ ...v, revenue: e.target.value })}
          />
        )}
      </td>
      <td className="px-3 py-2">
        <CommissionCell standing={row.commission} running={running} />
      </td>
      {canEdit && (
        <td className="px-3 py-2">
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {t('save')}
          </button>
          {saved && !dirty && (
            <span className="mt-1 block text-caption text-success">{t('saved')}</span>
          )}
          {error && (
            <span role="alert" className="mt-1 block text-caption text-danger">
              {error}
            </span>
          )}
          {row.target && (
            <span className="mt-1 block text-caption text-text-muted">
              {t('setBy', { name: row.target.updatedBy })}
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

export function TargetsEditor({
  rows,
  month,
  running,
  canEdit,
}: {
  rows: TargetRow[];
  month: string;
  /** The current month: a miss so far reads "not reached yet" */
  running: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations('sales.targets');
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  if (!rows.length) return <p className="mt-6 text-body-sm text-text-muted">{t('empty')}</p>;
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>
            <th className={th}>{t('rep')}</th>
            <th className={th}>{t('deals')}</th>
            <th className={th}>{t('orders')}</th>
            <th className={th}>{t('revenue')}</th>
            <th className={th}>{t('commission')}</th>
            {canEdit && <th className={th}>{t('action')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row
              key={`${r.user.id}-${month}`}
              row={r}
              month={month}
              running={running}
              canEdit={canEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
