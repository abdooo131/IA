'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { bpText } from '@/lib/sales-part2';
import {
  calculate,
  type CalcVersion,
  type ContractView,
  type ExampleLine,
  linesValue,
} from '@/lib/contracts';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';

/**
 * The example calculator: one shipment (products and quantities from the merchant's own,
 * paid cash or prepaid, its value) with every fee, VAT and what a failed attempt would cost,
 * and about what a month of N such shipments with U units stored costs (tiers band by band,
 * storage day by day, the minimum).
 */
export function ContractCalculator({
  version,
  view,
}: {
  version: CalcVersion | null;
  view: Pick<ContractView, 'standard' | 'vatBp' | 'standardFailedPercentBp' | 'products'>;
}) {
  const t = useTranslations('contracts.calc');
  const locale = useLocale();
  const priced = new Set((version?.productPrices ?? []).map((p) => p.skuId));
  // Start from a priced product when there is one, else the first product.
  const first = view.products.find((p) => priced.has(p.id)) ?? view.products[0];
  const [lines, setLines] = useState<ExampleLine[]>(
    first ? [{ skuId: first.id, quantity: 1 }] : [],
  );
  const [cash, setCash] = useState(true);
  const [amount, setAmount] = useState('');
  const [orders, setOrders] = useState('300');
  const [units, setUnits] = useState('500');
  const [adding, setAdding] = useState('');
  const fromLines = linesValue(lines, view.products);
  const orderPiastres = amount.trim() ? (parseEgp(amount) ?? 0) : lines.length ? fromLines : 40_000;
  const count = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : 0);
  const r = calculate(version, view.standard, view.vatBp, {
    orderPiastres,
    orders: count(orders),
    unitsStored: count(units),
    lines,
    cash,
    standardFailedPercentBp: view.standardFailedPercentBp,
  });
  const egp = (p: number) => <span className="ltr-iso font-bold">{formatEgp(p)}</span>;
  const name = (p: { titleEn: string; titleAr: string }) =>
    locale === 'ar' ? p.titleAr || p.titleEn : p.titleEn;
  const byId = new Map(view.products.map((p) => [p.id, p]));
  const breakdown = (
    [
      ['shipping', r.order.shippingFeePiastres],
      ['perProduct', r.order.productHandlingPiastres],
      ['orderFee', r.order.orderFeePiastres],
      ['codFee', r.order.codFeePiastres],
      ['packaging', r.order.packagingChargePiastres],
      ['vat', r.order.vatPiastres],
    ] as const
  ).filter(([k, v]) => v !== 0 || k === 'vat');
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-body font-bold">{t('title')}</h3>

      <div className="space-y-2">
        <p className="text-caption font-bold uppercase text-text-muted">{t('shipment')}</p>
        {lines.length === 0 && <p className="text-caption text-text-muted">{t('noProducts')}</p>}
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const p = byId.get(l.skuId);
            return (
              <li key={l.skuId} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-body-sm">
                  <span className="ltr-iso font-bold">{p?.sku}</span> {p ? name(p) : ''}
                  {priced.has(l.skuId) && (
                    <span className="ms-1 text-caption text-link">{t('hasPrice')}</span>
                  )}
                </span>
                <label className="flex items-center gap-1 text-caption">
                  {t('quantity')}
                  <input
                    inputMode="numeric"
                    dir="ltr"
                    value={String(l.quantity)}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, quantity: count(e.target.value) } : x,
                        ),
                      )
                    }
                    className={`${field} w-16`}
                  />
                </label>
                <button
                  type="button"
                  className="h-10 rounded-md px-2 text-body-sm text-danger"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  {t('remove')}
                </button>
              </li>
            );
          })}
        </ul>
        {view.products.length > 0 && (
          <label className="block text-caption">
            {t('addProduct')}
            <select
              value={adding}
              onChange={(e) => {
                const id = e.target.value;
                setAdding('');
                if (id && !lines.some((l) => l.skuId === id))
                  setLines([...lines, { skuId: id, quantity: 1 }]);
              }}
              className={`${field} mt-1`}
            >
              <option value="">{t('choose')}</option>
              {view.products.slice(0, 500).map((p) => (
                <option key={p.id} value={p.id} disabled={lines.some((l) => l.skuId === p.id)}>
                  {p.sku} · {name(p)}
                  {priced.has(p.id) ? ` · ${t('hasPrice')}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <fieldset className="flex flex-wrap items-center gap-3 text-body-sm">
            <legend className="sr-only">{t('payment')}</legend>
            <label className="flex h-10 items-center gap-2">
              <input type="radio" checked={cash} onChange={() => setCash(true)} />
              {t('cash')}
            </label>
            <label className="flex h-10 items-center gap-2">
              <input type="radio" checked={!cash} onChange={() => setCash(false)} />
              {t('prepaid')}
            </label>
          </fieldset>
          <label className="block text-caption">
            {t('orderValue')}
            <input
              inputMode="decimal"
              dir="ltr"
              value={amount}
              placeholder={formatEgp(lines.length ? fromLines : 40_000)}
              onChange={(e) => setAmount(e.target.value)}
              className={`${field} mt-1`}
            />
          </label>
        </div>
      </div>

      <p className="text-body-sm" data-testid="calc-order">
        {t.rich('oneOrder', {
          value: () => <span className="ltr-iso">{formatEgp(orderPiastres)}</span>,
          total: () => egp(r.order.totalPiastres),
          fees: () => <span className="ltr-iso">{formatEgp(r.order.feesPiastres)}</span>,
          vat: () => <span className="ltr-iso">{formatEgp(r.order.vatPiastres)}</span>,
        })}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption text-text-muted sm:grid-cols-3">
        {breakdown.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt>{t(`parts.${k}`)}</dt>
            <dd className="ltr-iso text-text">{formatEgp(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-body-sm" data-testid="calc-failed">
        {r.order.failedRule.mode === 'fixed'
          ? t.rich('failedFixed', { total: () => egp(r.order.failedTotalPiastres) })
          : t.rich('failedPercent', {
              percent: () => (
                <span className="ltr-iso">
                  {bpText(r.order.failedRule.mode === 'percent' ? r.order.failedRule.bp : 0)}%
                </span>
              ),
              total: () => egp(r.order.failedTotalPiastres),
            })}
      </p>

      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
        <label className="block text-caption">
          {t('orders')}
          <input
            inputMode="numeric"
            dir="ltr"
            value={orders}
            onChange={(e) => setOrders(e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <label className="block text-caption">
          {t('units')}
          <input
            inputMode="numeric"
            dir="ltr"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
      </div>
      <p className="text-body-sm" data-testid="calc-month">
        {t.rich('month', {
          orders: () => <span className="ltr-iso">{r.month.orders}</span>,
          units: () => <span className="ltr-iso">{count(units)}</span>,
          total: () => egp(r.month.totalPiastres),
        })}
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption text-text-muted sm:grid-cols-3">
        {(
          [
            ['shippingFees', r.month.shippingFeesPiastres],
            ['perProductFees', r.month.productHandlingPiastres],
            ['orderFees', r.month.orderFeesPiastres],
            ['codFees', r.month.codFeesPiastres],
            ['packagingCharges', r.month.packagingChargesPiastres],
            ['storage', r.month.storagePiastres],
            ['minimumTopUp', r.month.minimumTopUpPiastres],
            ['vat', r.month.vatPiastres],
            ['perOrder', r.month.perOrderPiastres ?? 0],
          ] as const
        )
          .filter(([k, v]) => v !== 0 || ['vat', 'perOrder', 'orderFees'].includes(k))
          .map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt>{t(k)}</dt>
              <dd className="ltr-iso text-text">{formatEgp(v)}</dd>
            </div>
          ))}
      </dl>
      <p className="text-caption text-text-muted">{t('note')}</p>
    </section>
  );
}
