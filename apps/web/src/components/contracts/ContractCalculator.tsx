'use client';

import type { ContractPrices } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { calculate, type ContractVersion } from '@/lib/contracts';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';

/**
 * The example calculator: what one cash order costs at these prices, and about what a month
 * of N orders with U units stored costs (tiers band by band, storage day by day, the minimum).
 */
export function ContractCalculator({
  version,
  standard,
  vatBp,
}: {
  version: Pick<ContractVersion, 'prices' | 'tiers' | 'minimumMonthlyFeePiastres'> | null;
  standard: ContractPrices;
  vatBp: number;
}) {
  const t = useTranslations('contracts.calc');
  const [order, setOrder] = useState('400');
  const [orders, setOrders] = useState('300');
  const [units, setUnits] = useState('500');
  const orderPiastres = parseEgp(order) ?? 0;
  const count = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text.trim()) : 0);
  const r = calculate(version, standard, vatBp, {
    orderPiastres,
    orders: count(orders),
    unitsStored: count(units),
  });
  const egp = (p: number) => <span className="ltr-iso font-bold">{formatEgp(p)}</span>;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-body font-bold">{t('title')}</h3>
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-caption">
          {t('orderValue')}
          <input
            inputMode="decimal"
            dir="ltr"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
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
      <p className="text-body-sm" data-testid="calc-order">
        {t.rich('oneOrder', {
          value: () => <span className="ltr-iso">{formatEgp(orderPiastres)}</span>,
          total: () => egp(r.order.totalPiastres),
          fees: () => <span className="ltr-iso">{formatEgp(r.order.feesPiastres)}</span>,
          vat: () => <span className="ltr-iso">{formatEgp(r.order.vatPiastres)}</span>,
        })}
      </p>
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
            ['orderFees', r.month.orderFeesPiastres],
            ['codFees', r.month.codFeesPiastres],
            ['storage', r.month.storagePiastres],
            ['minimumTopUp', r.month.minimumTopUpPiastres],
            ['vat', r.month.vatPiastres],
            ['perOrder', r.month.perOrderPiastres ?? 0],
          ] as const
        ).map(([k, v]) => (
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
