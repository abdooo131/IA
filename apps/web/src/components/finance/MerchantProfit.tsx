'use client';

import { type ContractTier, type WhatIfBase, type WhatIfParams, whatIf } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useMemo, useState } from 'react';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';

// Merchant profitability: one merchant's month (fees, costs, margin), the summary card on the
// merchant's admin page, and the what if calculator.

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';

export const COST_LINES = [
  'riderBonusPiastres',
  'riderOfficeCommissionPiastres',
  'riderSalaryPiastres',
  'storeCostsPiastres',
  'storageSpacePiastres',
  'damagePiastres',
  'packagingPiastres',
  'otherDirectPiastres',
] as const;

export interface MerchantProfitRow {
  merchant: { id: string; name: string };
  deliveredOrders: number;
  productsPiastres: number;
  codCashPiastres: number;
  feesByKind: Record<string, number>;
  feesPiastres: number;
  costs: Record<(typeof COST_LINES)[number], number>;
  costsPiastres: number;
  marginPiastres: number;
  marginPerOrderPiastres: number | null;
  marginBp: number | null;
}

export interface MerchantProfitDetail extends MerchantProfitRow {
  month: string;
  stores: {
    darkStoreId: string;
    orders: number;
    storeOrders: number;
    unitDays: number;
    storeUnitDays: number;
    store?: { code: string; nameEn: string; nameAr: string };
  }[];
  base: WhatIfBase;
  current: WhatIfParams;
  tiers: ContractTier[];
}

const pct = (bp: number | null) => (bp === null ? '–' : `${formatEgp(bp)}%`);

function Line({ label, value, strong }: { label: ReactNode; value: number; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-2 border-t border-line py-1.5 first:border-t-0 ${strong ? 'font-bold' : ''}`}
    >
      <span>{label}</span>
      <Amount piastres={value} strong={strong} />
    </div>
  );
}

/** Fees by kind and costs by line, with the margin. */
export function ProfitBreakdown({ row }: { row: MerchantProfitRow }) {
  const t = useTranslations('finance.merchantProfit');
  const tk = useTranslations('finance.kinds');
  const kinds = Object.entries(row.feesByKind).sort((a, b) => b[1] - a[1]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-4 text-body-sm">
        <h3 className="mb-2 text-h3">{t('feesByKind')}</h3>
        {kinds.map(([kind, v]) => (
          <Line key={kind} label={tk.has(kind) ? tk(kind) : kind} value={v} />
        ))}
        <Line label={t('fees')} value={row.feesPiastres} strong />
      </section>
      <section className="rounded-lg border border-line bg-surface p-4 text-body-sm">
        <h3 className="mb-2 text-h3">{t('costs')}</h3>
        {COST_LINES.map((k) => (
          <Line key={k} label={t(`costLines.${k}`)} value={row.costs[k]} />
        ))}
        <Line label={t('costs')} value={row.costsPiastres} strong />
        <Line label={t('margin')} value={row.marginPiastres} strong />
        {row.marginPerOrderPiastres !== null && (
          <Line label={t('perOrder')} value={row.marginPerOrderPiastres} />
        )}
      </section>
    </div>
  );
}

/** The card on the merchant's admin page: this month's fees, costs and margin. */
export function ProfitSummaryCard({ row, month }: { row: MerchantProfitRow; month: string }) {
  const t = useTranslations('finance.merchantProfit');
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3">{t('summary')}</h2>
        <span className="ltr-iso text-caption text-text-muted">{month}</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-body-sm sm:grid-cols-4">
        <div>
          <dt className="text-caption text-text-muted">{t('orders')}</dt>
          <dd className="ltr-iso text-h3">{row.deliveredOrders}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('fees')}</dt>
          <dd className="text-h3">
            <Amount piastres={row.feesPiastres} />
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('costs')}</dt>
          <dd className="text-h3">
            <Amount piastres={row.costsPiastres} />
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('margin')}</dt>
          <dd className="text-h3">
            <Amount piastres={row.marginPiastres} strong />
          </dd>
          <dd className="ltr-iso text-caption text-text-muted">
            {row.marginPerOrderPiastres !== null && (
              <>
                {formatEgp(row.marginPerOrderPiastres)} / {t('perOrder')} ·{' '}
              </>
            )}
            {pct(row.marginBp)}
          </dd>
        </div>
      </dl>
      <Link
        href={`/finance/merchant-profit/${row.merchant.id}?month=${month}`}
        className="text-body-sm font-bold text-link"
      >
        {t('details')}
      </Link>
    </section>
  );
}

const egpField = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));

/** Change the fee values and see the same month again. */
export function WhatIfCalculator({ detail }: { detail: MerchantProfitDetail }) {
  const t = useTranslations('finance.merchantProfit');
  const start = {
    shipping: egpField(detail.current.shippingFeePiastres ?? 0),
    fixed: egpField(detail.current.orderFixedPiastres),
    percent: formatEgp(detail.current.orderPercentBp),
    cod: formatEgp(detail.current.codPercentBp),
    minimum: egpField(detail.current.minimumPiastres),
  };
  const [form, setForm] = useState(start);
  const params: WhatIfParams | null = useMemo(() => {
    const shipping = parseEgp(form.shipping || '0');
    const fixed = parseEgp(form.fixed || '0');
    const percent = parseEgp(form.percent || '0');
    const cod = parseEgp(form.cod || '0');
    const minimum = form.minimum.trim() ? parseEgp(form.minimum) : null;
    if (shipping === null || fixed === null || percent === null || cod === null) return null;
    if (form.minimum.trim() && minimum === null) return null;
    if (percent > 10_000 || cod > 10_000) return null;
    return {
      shippingFeePiastres: shipping,
      orderFixedPiastres: fixed,
      orderPercentBp: percent,
      codPercentBp: cod,
      minimumPiastres: minimum,
    };
  }, [form]);
  const result = params ? whatIf(detail.base, params) : null;
  const booked = detail.feesByKind;
  const bookedOther = Object.entries(booked)
    .filter(([k]) => !['shipping_fee', 'order_fee', 'cod_fee', 'minimum_fee'].includes(k))
    .reduce((s, [, v]) => s + v, 0);
  const input = (k: keyof typeof form, label: string) => (
    <label className="block text-caption">
      {label}
      <input
        inputMode="decimal"
        dir="ltr"
        value={form[k]}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        className={`mt-1 ${field}`}
      />
    </label>
  );
  const rows: [string, number, number | undefined][] = [
    [t('shippingFee'), booked.shipping_fee ?? 0, result?.shippingFeePiastres],
    [t('orderFee'), booked.order_fee ?? 0, result?.orderFeePiastres],
    [t('codFee'), booked.cod_fee ?? 0, result?.codFeePiastres],
    [t('otherFees'), bookedOther, result?.otherFeesPiastres],
    [t('minimumTopUp'), booked.minimum_fee ?? 0, result?.minimumTopUpPiastres],
    [t('totalFees'), detail.feesPiastres, result?.feesPiastres],
    [t('costs'), detail.costsPiastres, detail.costsPiastres],
    [t('margin'), detail.marginPiastres, result?.marginPiastres],
  ];
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('whatIf')}</h2>
      <p className="max-w-3xl text-body-sm text-text-muted">{t('whatIfIntro')}</p>
      {detail.tiers.length > 0 && <p className="text-caption">{t('tiersNote')}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {input('shipping', t('shipping'))}
        {input('fixed', t('fixed'))}
        {input('percent', t('percent'))}
        {input('cod', t('codPercent'))}
        {input('minimum', t('minimumFee'))}
      </div>
      <button type="button" className={secondary} onClick={() => setForm(start)}>
        {t('reset')}
      </button>
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                {t('result')}
              </th>
              <th className="px-3 py-2 text-end text-label uppercase text-text-muted">
                {t('actual')}
              </th>
              <th className="px-3 py-2 text-end text-label uppercase text-text-muted">
                {t('scenario')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, actual, scenario]) => (
              <tr key={label} className="border-t border-line">
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 text-end">
                  <Amount piastres={actual} />
                </td>
                <td className="px-3 py-2 text-end font-bold">
                  {scenario === undefined ? '–' : <Amount piastres={scenario} />}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-line">
              <td className="px-3 py-2">{t('perOrder')}</td>
              <td className="px-3 py-2 text-end">
                {detail.marginPerOrderPiastres === null ? (
                  '–'
                ) : (
                  <Amount piastres={detail.marginPerOrderPiastres} />
                )}
              </td>
              <td className="px-3 py-2 text-end font-bold">
                {result?.marginPerOrderPiastres == null ? (
                  '–'
                ) : (
                  <Amount piastres={result.marginPerOrderPiastres} />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
