'use client';

import {
  ALL_INCLUSIVE_ZERO_KEYS,
  CONTRACT_PRICE_KEYS,
  type ContractPriceKey,
  exampleMonth,
  PAYOUT_SCHEDULES,
  type PayoutScheduleName,
  type ProposalFees,
  proposalApproval,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiGetClient, apiSend } from '@/lib/api-client';
import {
  isPercent,
  newTierRow,
  type NowZone,
  PARCEL_SIZES,
  type ParcelZone,
  parseTierRows,
  type TierRow,
  tierRowsFrom,
  zoneListPrice,
} from '@/lib/contracts';
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
  PROPOSAL_FEE_KEYS,
  type DealProposals,
  type ProposalView,
} from '@/lib/sales-part2';
import { parseEgp } from '@/lib/money';

interface ProductRowForm {
  skuId: string | null;
  sku: string;
  name: string;
  price: string;
}

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * A proposal's rates and terms: every fee (from the fee settings), volume tiers, the example
 * month's volume, the monthly minimum, deposit, credit limit and the contract's start, length
 * and notice. Shows the discount against the settings as it is typed, and whether a sales
 * manager must approve before it can be sent.
 */
const shareText = (bp: number | null | undefined) =>
  bp === null || bp === undefined ? '' : bpText(bp);

export function ProposalForm({
  dealId,
  proposal,
  defaults,
  maxDiscountBp,
  expectedOrders,
  products = [],
  standardFailedPercentBp = 10_000,
  onDone,
  onCancel,
}: {
  dealId: string;
  /** A draft to edit; a new proposal when left out */
  proposal?: ProposalView;
  defaults: ProposalFees;
  /** The merchant's products to price (empty: free rows only) */
  products?: DealProposals['products'];
  standardFailedPercentBp?: number;
  maxDiscountBp: number;
  expectedOrders: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('sales.proposals');
  const te = useTranslations('sales.errors');
  const locale = useLocale();
  const fees = proposal?.fees ?? defaults;
  const start = {
    failedPercent:
      proposal?.failedDeliveryPercentBp === null || proposal?.failedDeliveryPercentBp === undefined
        ? ''
        : bpText(proposal.failedDeliveryPercentBp),
    products: (proposal?.productPrices ?? []).map((r): ProductRowForm => ({
      skuId: r.skuId,
      sku: r.sku,
      name: r.name,
      price: egpInput(r.pricePiastres),
    })),
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
    tiers: tierRowsFrom(proposal?.tiers ?? []) as TierRow[],
    payoutSchedule: (proposal?.payoutSchedule ?? '') as '' | PayoutScheduleName,
    minimumPayout: egpInput(proposal?.minimumPayoutPiastres ?? null),
    promise: proposal?.promiseMinutes ? String(proposal.promiseMinutes) : '',
    attempts: proposal?.deliveryAttempts ? String(proposal.deliveryAttempts) : '',
    // Next day parcels (Shiply): quoted only when ticked; empty shares keep the standard.
    parcels: !!proposal?.parcels,
    parcelDiscount: shareText(proposal?.parcels?.discountBp),
    parcelCodFee: shareText(proposal?.parcels?.codFeeBp),
    parcelReturnFee: shareText(proposal?.parcels?.returnFeeBp),
    // Every price in the agreement (owner, 2026-11-08): pounds as typed, empty is none.
    zonePrices: Object.fromEntries(
      (proposal?.zonePrices ?? []).map((p) => [p.zoneId, egpInput(p.pricePiastres)]),
    ) as Record<string, string>,
    parcelPrices: Object.fromEntries(
      (proposal?.parcels?.prices ?? []).map((p) => [
        `${p.zoneCode}/${p.size}`,
        egpInput(p.pricePiastres),
      ]),
    ) as Record<string, string>,
  };
  const [v, setV] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newActionKey);
  const [zones, setZones] = useState<{ nowZones: NowZone[]; parcelZones: ParcelZone[] }>({
    nowZones: [],
    parcelZones: [],
  });
  useEffect(() => {
    void apiGetClient<{ nowZones: NowZone[]; parcelZones: ParcelZone[] }>(
      '/sales/price-zones',
    ).then((r) => {
      if (r.ok) setZones(r.data);
    });
  }, []);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);

  // What the form holds, read as the API takes it (null: not valid yet).
  const parsed = (() => {
    const out = {} as ProposalFees;
    for (const k of PROPOSAL_FEE_KEYS) {
      const value = parseFee(k, v.fees[k]);
      if (value === null) return null;
      out[k] = value;
    }
    let failedDeliveryPercentBp: number | null = null;
    if (v.failedPercent.trim()) {
      const bp = parseFee('orderPercentBp', v.failedPercent);
      if (bp === null) return null;
      failedDeliveryPercentBp = bp;
    }
    const productPrices = [];
    for (const r of v.products) {
      if (!r.sku.trim() && !r.price.trim()) continue;
      const price = parseEgp(r.price);
      if (!r.sku.trim() || price === null) return null;
      productPrices.push({
        skuId: r.skuId,
        sku: r.sku.trim(),
        name: r.name.trim(),
        pricePiastres: price,
      });
    }
    if (new Set(productPrices.map((p) => p.sku.toLowerCase())).size !== productPrices.length)
      return null;
    const tiers = parseTierRows(v.tiers);
    const orders = parseCount(v.orders);
    const minimumPayout = parseMoney(v.minimumPayout);
    const promise = parseCount(v.promise);
    const attempts = parseCount(v.attempts);
    if (Number.isNaN(minimumPayout) || Number.isNaN(promise) || Number.isNaN(attempts)) return null;
    if (promise !== null && (promise < 10 || promise > 1440)) return null;
    if (attempts !== null && (attempts < 1 || attempts > 10)) return null;
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
    const share = (text: string) =>
      text.trim() ? (parseFee('orderPercentBp', text) ?? Number.NaN) : null;
    const parcelShares = [share(v.parcelDiscount), share(v.parcelCodFee), share(v.parcelReturnFee)];
    if (parcelShares.some((x) => Number.isNaN(x))) return null;
    const zonePrices: { zoneId: string; pricePiastres: number }[] = [];
    for (const [zoneId, text] of Object.entries(v.zonePrices)) {
      if (!text.trim()) continue;
      const price = parseEgp(text);
      if (price === null) return null;
      zonePrices.push({ zoneId, pricePiastres: price });
    }
    const parcelPrices: {
      zoneCode: string;
      size: (typeof PARCEL_SIZES)[number];
      pricePiastres: number;
    }[] = [];
    if (v.parcels)
      for (const [k, text] of Object.entries(v.parcelPrices)) {
        if (!text.trim()) continue;
        const price = parseEgp(text);
        if (price === null) return null;
        const [zoneCode, size] = k.split('/') as [string, (typeof PARCEL_SIZES)[number]];
        parcelPrices.push({ zoneCode, size, pricePiastres: price });
      }
    return {
      includesParcels: v.parcels,
      parcelDiscountBp: v.parcels ? parcelShares[0]! : null,
      parcelCodFeeBp: v.parcels ? parcelShares[1]! : null,
      parcelReturnFeeBp: v.parcels ? parcelShares[2]! : null,
      parcelPrices,
      zonePrices,
      ...out,
      failedDeliveryPercentBp,
      productPrices,
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
      payoutSchedule: v.payoutSchedule || null,
      minimumPayoutPiastres: minimumPayout,
      promiseMinutes: promise,
      deliveryAttempts: attempts,
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
  /** The all inclusive preset: the shipping fee kept, the other charges 0, failures 100%. */
  const allInclusive = () => {
    const next = { ...v.fees };
    for (const k of ALL_INCLUSIVE_ZERO_KEYS) next[k] = '0';
    setV({ ...v, fees: next, failedPercent: '100' });
    setTimeout(() => document.getElementById('proposal-shippingFeePiastres')?.focus(), 0);
  };
  const setProduct = (i: number, patch: Partial<ProductRowForm>) =>
    setV({ ...v, products: v.products.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const [picking, setPicking] = useState('');
  const setTier = (i: number, k: 'fromOrder' | ContractPriceKey, text: string) =>
    setV({
      ...v,
      tiers: v.tiers.map((r, j) =>
        j !== i
          ? r
          : k === 'fromOrder'
            ? { ...r, fromOrder: text }
            : { ...r, values: { ...r.values, [k]: text } },
      ),
    });

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
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-raised p-3">
        <p className="min-w-0 flex-1 text-caption text-text-muted">{t('allInclusiveHint')}</p>
        <button type="button" className="btn-secondary" onClick={allInclusive}>
          {t('allInclusive')}
        </button>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-body-sm font-bold">{t('rates')}</legend>
        {PROPOSAL_FEE_KEYS.map((k) => (
          <label key={k} className="text-body-sm">
            <span className="font-semibold">{t(`fees.${k}`)}</span>
            <span className="flex items-center gap-2">
              <input
                id={`proposal-${k}`}
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
        <label className="text-body-sm">
          <span className="font-semibold">{t('failedPercent')}</span>
          <span className="flex items-center gap-2">
            <input
              className={`${field} mt-1`}
              inputMode="decimal"
              dir="ltr"
              value={v.failedPercent}
              placeholder="–"
              onChange={(e) => setV({ ...v, failedPercent: e.target.value })}
            />
            <span className="text-caption text-text-muted">%</span>
          </span>
          <span className="text-caption text-text-muted">
            {t('failedPercentHint', { percent: `${bpText(standardFailedPercentBp)}%` })}
          </span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="text-body-sm font-bold">{t('productPrices')}</legend>
        <p className="text-caption text-text-muted">{t('productPricesHint')}</p>
        <ul className="mt-2 space-y-2">
          {v.products.map((r, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_8rem_auto]"
            >
              <label className="min-w-0 text-caption">
                {t('productSku')}
                <input
                  className={field}
                  dir="ltr"
                  value={r.sku}
                  readOnly={!!r.skuId}
                  onChange={(e) => setProduct(i, { sku: e.target.value })}
                />
              </label>
              <label className="min-w-0 text-caption">
                {t('productName')}
                <input
                  className={field}
                  value={r.name}
                  readOnly={!!r.skuId}
                  onChange={(e) => setProduct(i, { name: e.target.value })}
                />
              </label>
              <label className="min-w-0 text-caption">
                {t('productPrice')}
                <input
                  className={field}
                  inputMode="decimal"
                  dir="ltr"
                  value={r.price}
                  onChange={(e) => setProduct(i, { price: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="h-10 self-end rounded-md px-2 text-body-sm text-danger"
                onClick={() => setV({ ...v, products: v.products.filter((_, j) => j !== i) })}
              >
                {t('removeProduct')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {products.length > 0 && (
            <label className="min-w-0 flex-1 text-caption">
              {t('pickProduct')}
              <select
                className={`${field} mt-1`}
                value={picking}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  setPicking('');
                  if (!p || v.products.some((r) => r.skuId === p.id)) return;
                  setV({
                    ...v,
                    products: [
                      ...v.products,
                      {
                        skuId: p.id,
                        sku: p.sku,
                        name: locale === 'ar' ? p.titleAr || p.titleEn : p.titleEn,
                        price: '',
                      },
                    ],
                  });
                }}
              >
                <option value="">{t('choose')}</option>
                {products.slice(0, 500).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {locale === 'ar' ? p.titleAr || p.titleEn : p.titleEn}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setV({
                ...v,
                products: [...v.products, { skuId: null, sku: '', name: '', price: '' }],
              })
            }
          >
            {t('addFreeRow')}
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-body-sm font-bold">{t('tiers')}</legend>

        <p className="text-caption text-text-muted">{t('tiersHint')}</p>
        <ul className="mt-2 space-y-2">
          {v.tiers.map((r, i) => (
            <li key={i} className="space-y-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label className="text-caption">
                  {t('tierFrom')}
                  <input
                    className={`${field} max-w-[8rem]`}
                    inputMode="numeric"
                    dir="ltr"
                    value={r.fromOrder}
                    onChange={(e) => setTier(i, 'fromOrder', e.target.value)}
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CONTRACT_PRICE_KEYS.map((k) => (
                  <label key={k} className="min-w-0 text-caption">
                    {t(`fees.${k}`)} ({isPercent(k) ? '%' : t('egp')})
                    <input
                      className={field}
                      inputMode="decimal"
                      dir="ltr"
                      placeholder="–"
                      value={r.values[k]}
                      onChange={(e) => setTier(i, k, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn-secondary mt-2"
          onClick={() => setV({ ...v, tiers: [...v.tiers, newTierRow(v.tiers)] })}
        >
          {t('addTier')}
        </button>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-body-sm font-bold">{t('paymentAndPromises')}</legend>
        <label className="text-body-sm">
          <span className="font-semibold">{t('payoutSchedule')}</span>
          <select
            className={`${field} mt-1`}
            value={v.payoutSchedule}
            onChange={(e) =>
              setV({ ...v, payoutSchedule: e.target.value as '' | PayoutScheduleName })
            }
          >
            <option value="">{t('payoutOwnChoice')}</option>
            {PAYOUT_SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {t(`schedules.${s}`)}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ['minimumPayout', t('minimumPayout'), 'decimal'],
            ['promise', t('promiseMinutes'), 'numeric'],
            ['attempts', t('deliveryAttempts'), 'numeric'],
          ] as const
        ).map(([name, label, mode]) => (
          <label key={name} className="text-body-sm">
            <span className="font-semibold">{label}</span>
            <input
              className={`${field} mt-1`}
              inputMode={mode}
              dir="ltr"
              placeholder={t('standardPlaceholder')}
              value={v[name]}
              onChange={(e) => setV({ ...v, [name]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>

      {zones.nowZones.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-body-sm font-bold">{t('zonePrices.title')}</legend>
          <p className="text-caption text-text-muted">{t('zonePrices.hint')}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {zones.nowZones.map((z) => (
              <label key={z.id} className="text-body-sm">
                <span className="font-semibold">
                  <span className="ltr-iso">{z.code}</span> ·{' '}
                  {locale === 'ar' ? z.nameAr : z.nameEn}
                </span>
                <input
                  className={`${field} mt-1`}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder={t('zonePrices.placeholder')}
                  value={v.zonePrices[z.id] ?? ''}
                  onChange={(e) =>
                    setV({ ...v, zonePrices: { ...v.zonePrices, [z.id]: e.target.value } })
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-body-sm font-bold">{t('parcels.title')}</legend>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={v.parcels}
            onChange={(e) => setV({ ...v, parcels: e.target.checked })}
          />
          {t('parcels.include')}
        </label>
        {v.parcels && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['parcelDiscount', t('parcels.discount')],
                ['parcelCodFee', t('parcels.codFee')],
                ['parcelReturnFee', t('parcels.returnFee')],
              ] as const
            ).map(([name, label]) => (
              <label key={name} className="text-body-sm">
                <span className="font-semibold">{label} (%)</span>
                <input
                  className={`${field} mt-1`}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder={t('standardPlaceholder')}
                  value={v[name]}
                  onChange={(e) => setV({ ...v, [name]: e.target.value })}
                />
              </label>
            ))}
          </div>
        )}
        {v.parcels && zones.parcelZones.length > 0 && (
          <div className="space-y-1">
            <p className="text-body-sm font-semibold">{t('parcels.pricesTitle')}</p>
            <p className="text-caption text-text-muted">{t('parcels.pricesHint')}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-body-sm">
                <thead>
                  <tr className="text-caption text-text-muted">
                    <th className="py-1 text-start font-semibold">{t('parcels.zone')}</th>
                    {PARCEL_SIZES.map((size) => (
                      <th key={size} className="py-1 text-start font-semibold">
                        {size}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {zones.parcelZones.map((z) => (
                    <tr key={z.code}>
                      <td className="py-1 pe-2">{z.name}</td>
                      {PARCEL_SIZES.map((size) => {
                        const k = `${z.code}/${size}`;
                        return (
                          <td key={size} className="py-1 pe-1">
                            <input
                              className={field}
                              inputMode="decimal"
                              dir="ltr"
                              aria-label={`${z.name} ${size}`}
                              placeholder={egpInput(zoneListPrice(z, size))}
                              value={v.parcelPrices[k] ?? ''}
                              onChange={(e) =>
                                setV({
                                  ...v,
                                  parcelPrices: { ...v.parcelPrices, [k]: e.target.value },
                                })
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
