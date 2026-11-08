'use client';

import {
  CONTRACT_PRICE_KEYS,
  type ContractPriceKey,
  type ContractPrices,
  type ContractTier,
  failedDeliveryRule,
  tierValue,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import { bpText } from '@/lib/sales-part2';
import {
  type ContractProductPriceRow,
  type ContractVersion,
  type ContractView,
  isAllInclusive,
  isPercent,
  tierColumns,
  type VersionDisplayStatus,
} from '@/lib/contracts';

// The contract as a clean document: every price beside the standard one, the volume tiers as
// a table of "orders a month: from → prices", payment terms, promises, dates and notes.

export function priceText(k: ContractPriceKey, value: number) {
  return isPercent(k) ? `${bpText(value)}%` : `${formatEgp(value)} EGP`;
}

/** Status pills: the status color on a 14% tint of itself. */
const TINT = 'bg-[color-mix(in_srgb,currentColor_14%,transparent)]';
const PILL: Record<VersionDisplayStatus, string> = {
  draft: 'text-status-needs-action',
  in_force: 'text-status-delivered',
  scheduled: 'text-status-new',
  superseded: 'text-text-muted',
  ended: 'text-danger',
};

export function VersionPill({ status }: { status: VersionDisplayStatus }) {
  const t = useTranslations('contracts.status');
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-caption font-bold ${TINT} ${PILL[status]}`}>
      {t(status)}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-body font-bold">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-2 first:border-t-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
      <dt className="text-body-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm font-bold">
        {children}
        {hint && <span className="block text-caption font-normal text-text-muted">{hint}</span>}
      </dd>
    </div>
  );
}

/** The tiers as "orders a month: from → prices": cards on phones, a table from sm up. */
export function TierTable({ tiers }: { tiers: readonly ContractTier[] }) {
  const t = useTranslations('contracts');
  const columns = tierColumns(tiers);
  if (!tiers.length) return <p className="text-body-sm text-text-muted">{t('noTiers')}</p>;
  return (
    <>
      <ul className="space-y-2 sm:hidden">
        {tiers.map((tier) => (
          <li key={tier.fromOrder} className="rounded-md border border-line p-3">
            <p className="text-body-sm font-bold">
              {t('fromOrder')} <span className="ltr-iso">{tier.fromOrder}</span>
            </p>
            <dl className="mt-1 space-y-0.5 text-body-sm">
              {columns.map((k) => {
                const v = tierValue(tier, k);
                return (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-text-muted">{t(`fees.${k}`)}</dt>
                    <dd className="ltr-iso">{v === null ? '–' : priceText(k, v)}</dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="bg-surface-raised">
              <th className="px-2 py-1.5 text-start font-bold">{t('fromOrder')}</th>
              {columns.map((k) => (
                <th key={k} className="px-2 py-1.5 text-start font-bold">
                  {t(`fees.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier.fromOrder} className="border-t border-line">
                <td className="ltr-iso px-2 py-1.5 font-bold">{tier.fromOrder}+</td>
                {columns.map((k) => {
                  const v = tierValue(tier, k);
                  return (
                    <td key={k} className="ltr-iso px-2 py-1.5">
                      {v === null ? '–' : priceText(k, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('tiersRule')}</p>
    </>
  );
}

/** What a failed attempt costs under a version, in words. */
export function FailedRule({
  prices,
  failedDeliveryPercentBp,
  standard,
  standardFailedPercentBp,
}: {
  prices: ContractVersion['prices'];
  failedDeliveryPercentBp: number | null;
  standard: ContractPrices;
  standardFailedPercentBp: number;
}) {
  const t = useTranslations('contracts.failed');
  const rule = failedDeliveryRule(
    { failedDeliveryPiastres: prices.failedDeliveryPiastres, failedDeliveryPercentBp },
    null,
    {
      failedDeliveryPiastres: prices.failedDeliveryPiastres ?? standard.failedDeliveryPiastres,
      shippingFeePiastres: prices.shippingFeePiastres ?? standard.shippingFeePiastres,
    },
    standardFailedPercentBp,
  );
  return (
    <span className="ltr-iso">
      {rule.mode === 'fixed'
        ? t('fixedRule', { amount: formatEgp(rule.piastres) })
        : t('percentRule', { percent: `${bpText(rule.bp)}%` })}
    </span>
  );
}

/** Per product prices: the first rows, then "and N more" with the full list in the file. */
export function ProductPriceList({
  rows,
  limit = 10,
  csvHref,
}: {
  rows: readonly ContractProductPriceRow[];
  limit?: number;
  csvHref?: string | null;
}) {
  const t = useTranslations('contracts.products');
  const locale = useLocale();
  if (!rows.length) return <p className="text-body-sm text-text-muted">{t('none')}</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-md border border-line">
        {rows.slice(0, limit).map((r) => (
          <li key={r.skuId} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="min-w-0 text-body-sm">
              <span className="ltr-iso block truncate font-bold">{r.sku}</span>
              <span className="block truncate text-caption text-text-muted">
                {locale === 'ar' ? r.titleAr || r.titleEn : r.titleEn}
              </span>
            </span>
            <span className="ltr-iso shrink-0 text-body-sm font-bold text-link">
              {formatEgp(r.pricePiastres)} EGP
            </span>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <p className="text-caption text-text-muted">{t('andMore', { n: rows.length - limit })}</p>
      )}
      <p className="text-caption text-text-muted">{t('rule')}</p>
      {csvHref && (
        <a className="btn-secondary inline-flex h-10 items-center" href={csvHref}>
          {t('export')}
        </a>
      )}
    </div>
  );
}

/** Every price of a version beside the standard one. */
export function PriceTable({
  prices,
  standard,
  vatBp,
  failedDeliveryPercentBp = null,
  standardFailedPercentBp = 10_000,
}: {
  prices: ContractVersion['prices'];
  standard: ContractPrices;
  vatBp: number;
  failedDeliveryPercentBp?: number | null;
  standardFailedPercentBp?: number;
}) {
  const t = useTranslations('contracts');
  return (
    <div className="rounded-md border border-line">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] gap-2 bg-surface-raised px-3 py-1.5 text-caption font-bold uppercase text-text-muted sm:grid">
        <span>{t('fee')}</span>
        <span>{t('standard')}</span>
        <span>{t('agreed')}</span>
      </div>
      <ul>
        {CONTRACT_PRICE_KEYS.map((k) => {
          const own = prices[k];
          return (
            <li
              key={k}
              className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-line px-3 py-2 first:border-t-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)] sm:first:border-t"
            >
              <span className="col-span-2 text-body-sm sm:col-span-1">
                {t(`fees.${k}`)}
                <span className="block text-caption text-text-muted">{t(`units.${k}`)}</span>
              </span>
              <span className="text-body-sm text-text-muted">
                <span className="sm:hidden">{t('standard')}: </span>
                <span className="ltr-iso">{priceText(k, standard[k])}</span>
              </span>
              <span className={`text-body-sm ${own === null ? '' : 'font-bold text-link'}`}>
                {own === null ? (
                  t('asStandard')
                ) : (
                  <span className="ltr-iso">{priceText(k, own)}</span>
                )}
              </span>
            </li>
          );
        })}
        <li className="grid grid-cols-2 gap-x-2 border-t border-line px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)]">
          <span className="col-span-2 text-body-sm sm:col-span-1">
            {t('failed.title')}
            <span className="block text-caption text-text-muted">{t('failed.titleHint')}</span>
          </span>
          <span className="col-span-2 text-body-sm font-bold sm:col-span-2">
            <FailedRule
              prices={prices}
              failedDeliveryPercentBp={failedDeliveryPercentBp}
              standard={standard}
              standardFailedPercentBp={standardFailedPercentBp}
            />
          </span>
        </li>
        <li className="grid grid-cols-2 gap-x-2 border-t border-line px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)]">
          <span className="col-span-2 text-body-sm sm:col-span-1">
            {t('vat')}
            <span className="block text-caption text-text-muted">{t('vatHint')}</span>
          </span>
          <span className="ltr-iso text-body-sm text-text-muted">{bpText(vatBp)}%</span>
          <span className="text-body-sm">{t('vatSame')}</span>
        </li>
      </ul>
      <p className="border-t border-line px-3 py-2 text-caption text-text-muted">
        {isAllInclusive(prices) && <>{t('allInclusiveNote')} </>}
        {t('packagingHint')}
      </p>
    </div>
  );
}

/** One version of a merchant's contract, as a document. */
export function ContractDocument({
  view,
  version: v,
  internal,
  bankSlot,
  csvBase = null,
}: {
  view: ContractView;
  version: ContractVersion;
  /** Shows the internal note and who did what (never to the merchant) */
  internal: boolean;
  /** The bank row's own content (the editor for merchants manage) */
  bankSlot?: ReactNode;
  /** Where the version's prices file is offered (the team's pages), e.g. /api/admin/merchants/<id> */
  csvBase?: string | null;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const money = (p: number | null) =>
    p === null ? t('none') : <span className="ltr-iso">{formatEgp(p)} EGP</span>;
  const bank = view.merchant.bank;
  const stores = view.stores.filter((s) => v.storeIds.includes(s.id));
  return (
    <article className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-h3">{v.label}</h2>
          <p className="text-body-sm text-text-muted">
            {v.effectiveFrom && v.status !== 'draft'
              ? t('effectiveFrom', { day: isoToDayFirst(v.effectiveFrom) })
              : t('notActivated')}
            {internal && v.activatedBy && v.activatedAt && (
              <> · {t('activatedBy', { name: v.activatedBy })}</>
            )}
          </p>
        </div>
        <VersionPill status={v.displayStatus} />
      </header>

      <Section title={t('sections.prices')}>
        <PriceTable
          prices={v.prices}
          standard={view.standard}
          vatBp={view.vatBp}
          failedDeliveryPercentBp={v.failedDeliveryPercentBp}
          standardFailedPercentBp={view.standardFailedPercentBp}
        />
      </Section>

      <Section title={t('sections.productPrices')}>
        <ProductPriceList
          rows={v.productPrices}
          csvHref={
            csvBase && v.productPrices.length
              ? `${csvBase}/contract/versions/${v.id}/product-prices.csv`
              : null
          }
        />
      </Section>

      <Section title={t('sections.tiers')}>
        <p className="mb-2 text-caption font-bold uppercase text-text-muted">{t('tiersTitle')}</p>
        <TierTable tiers={v.tiers} />
      </Section>

      <Section title={t('sections.parcels')}>
        <dl>
          <Row label={t('parcels.discount')}>
            {v.parcels.discountBp === null
              ? t('parcels.standard')
              : `${bpText(v.parcels.discountBp)}%`}
          </Row>
          <Row label={t('parcels.codFee')}>
            {v.parcels.codFeeBp === null ? t('parcels.standard') : `${bpText(v.parcels.codFeeBp)}%`}
          </Row>
          <Row label={t('parcels.returnFee')}>
            {v.parcels.returnFeeBp === null
              ? t('parcels.standard')
              : `${bpText(v.parcels.returnFeeBp)}%`}
          </Row>
          {v.parcels.prices.map((p) => (
            <Row
              key={`${p.zoneCode}/${p.size}`}
              label={`${t('parcels.zone')} ${p.zoneCode} · ${p.size}`}
            >
              {money(p.pricePiastres)}
            </Row>
          ))}
        </dl>
      </Section>

      {(v.zonePrices ?? []).length > 0 && (
        <Section title={t('zonesTitle')}>
          <dl>
            {(v.zonePrices ?? []).map((p) => (
              <Row key={p.zoneId} label={`${p.code} · ${locale === 'ar' ? p.nameAr : p.nameEn}`}>
                {money(p.pricePiastres)}
              </Row>
            ))}
          </dl>
        </Section>
      )}

      <Section title={t('sections.payment')}>
        <dl>
          <Row
            label={t('payoutSchedule')}
            hint={
              view.scheduleDiffers && v.id === view.current?.id
                ? t('scheduleDiffers', {
                    schedule: t(`schedules.${view.merchant.payoutSchedule}`),
                  })
                : undefined
            }
          >
            {v.payoutSchedule ? t(`schedules.${v.payoutSchedule}`) : t('ownChoice')}
            {view.scheduleDiffers && v.id === view.current?.id && (
              <span
                className={`ms-2 rounded-pill px-2 py-0.5 text-caption text-status-needs-action ${TINT}`}
              >
                {t('differs')}
              </span>
            )}
          </Row>
          <Row
            label={t('minimumPayout')}
            hint={v.minimumPayoutPiastres === null ? t('standardValue') : undefined}
          >
            {money(v.minimumPayoutPiastres ?? view.standardTerms.minimumPayoutPiastres)}
          </Row>
          <Row label={t('bank')}>
            {bankSlot ??
              (bank.iban || bank.bankAccountNumber ? (
                <span className="break-words">
                  {[bank.bankName, bank.beneficiaryName].filter(Boolean).join(' · ')}
                  <span className="ltr-iso block">{bank.iban ?? bank.bankAccountNumber}</span>
                </span>
              ) : (
                t('noBank')
              ))}
          </Row>
          <Row
            label={t('minimumFee')}
            hint={v.minimumMonthlyFeePiastres ? t('minimumFeeHint') : undefined}
          >
            {money(v.minimumMonthlyFeePiastres)}
          </Row>
          <Row
            label={t('deposit')}
            hint={t('held', { amount: formatEgp(view.depositHeldPiastres) })}
          >
            {money(v.securityDepositPiastres)}
          </Row>
          <Row label={t('creditLimit')}>{money(v.creditLimitPiastres)}</Row>
        </dl>
      </Section>

      <Section title={t('sections.promises')}>
        <dl>
          <Row
            label={t('promise')}
            hint={v.promiseMinutes === null ? t('standardValue') : t('informative')}
          >
            {t('minutes', { n: v.promiseMinutes ?? view.standardTerms.promiseMinutes })}
          </Row>
          <Row
            label={t('attempts')}
            hint={v.deliveryAttempts === null ? t('standardValue') : undefined}
          >
            <span className="ltr-iso">
              {v.deliveryAttempts ?? view.standardTerms.deliveryAttempts}
            </span>
          </Row>
          <Row label={t('stores')} hint={t('informative')}>
            {stores.length
              ? stores.map((s) => `${locale === 'ar' ? s.nameAr : s.nameEn} (${s.code})`).join(', ')
              : t('allStores')}
          </Row>
          {v.coverageNote && <Row label={t('areas')}>{v.coverageNote}</Row>}
        </dl>
      </Section>

      <Section title={t('sections.dates')}>
        <dl>
          <Row label={t('start')}>
            <span className="ltr-iso">{isoToDayFirst(v.startDate)}</span>
          </Row>
          <Row label={t('end')}>
            {v.endDate ? (
              <span className="ltr-iso">{isoToDayFirst(v.endDate)}</span>
            ) : (
              t('openEnded')
            )}
          </Row>
          <Row
            label={t('notice')}
            hint={v.noticeBy ? t('noticeBy', { day: isoToDayFirst(v.noticeBy) }) : undefined}
          >
            {t('days', { n: v.noticeDays })}
          </Row>
        </dl>
      </Section>

      <Section title={t('sections.terms')}>
        <p className="whitespace-pre-line break-words text-body-sm">{v.terms || t('noTerms')}</p>
      </Section>

      {internal && v.internalNote && (
        <Section title={t('sections.internal')}>
          <p className="whitespace-pre-line break-words text-body-sm">{v.internalNote}</p>
        </Section>
      )}
    </article>
  );
}

/** Where the month stands: deliveries, the next band, deposit held, balance. */
export function ContractStanding({ view, internal }: { view: ContractView; internal: boolean }) {
  const t = useTranslations('contracts');
  return (
    <ul className="space-y-1 rounded-lg border border-line bg-surface p-4 text-body-sm">
      <li>{t('monthSoFar', { count: view.deliveredThisMonth })}</li>
      {view.nextOrderTier && <li>{t('nextBand', { from: view.nextOrderTier.fromOrder })}</li>}
      {internal && view.owedPiastres !== null && (
        <li>{t('owed', { amount: formatEgp(view.owedPiastres) })}</li>
      )}
      {view.overCreditLimit && <li className="font-bold text-danger">{t('overLimit')}</li>}
    </ul>
  );
}
