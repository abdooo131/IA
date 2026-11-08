import { CONTRACT_PRICE_KEYS, CONTRACT_PRICES, tierValue } from '@shiplynow/shared';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Logo } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { ProposalAnswer } from '@/components/sales/ProposalAnswer';
import { formatCairoDateTime, formatCount, formatEgp } from '@/lib/format';
import { bpText, type PublicProposal } from '@/lib/sales-part2';
import { getTheme } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('proposalPage');
  // The link is private to the brand: keep it out of search engines.
  return { title: t('pageTitle'), robots: { index: false, follow: false } };
}

/**
 * A brand's proposal, opened from the link the rep sent (docs/SALES.md 8). No sign in: our
 * company, the rates in plain words, an example month, the terms and Accept or Decline.
 */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, locale] = await Promise.all([getTranslations('proposalPage'), getLocale()]);
  const res = await fetch(`${apiUrl}/proposal/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  const p = res.ok ? ((await res.json()) as PublicProposal) : null;
  const egp = (piastres: number) => t('egpAmount', { amount: formatEgp(piastres) });
  const pct = (bp: number) => `${bpText(bp)}%`;
  // With a shipping fee, a charge at 0 is part of it (all inclusive).
  const shipping = p ? p.fees.shippingFeePiastres : 0;
  const orIncluded = (value: number, text: string) =>
    shipping > 0 && value === 0 ? t('includedInShipping') : text;
  const row = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="grid gap-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dt className="font-semibold">
        {label}
        {hint && <span className="block text-caption font-normal text-text-muted">{hint}</span>}
      </dt>
      <dd className="[overflow-wrap:anywhere] sm:text-end">{value}</dd>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Logo alt={t('brand')} />
        <PreferencesMenu theme={await getTheme()} />
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-2">
        {!p ? (
          <p role="alert" className="rounded-lg border border-line bg-surface p-6 text-body">
            {res.status === 404 ? t('notFound') : t('unavailable')}
          </p>
        ) : (
          <>
            <p className="text-caption uppercase text-text-muted">
              <span className="ltr-iso">{p.label}</span>
              {p.version > 1 && ` · ${t('version', { n: p.version })}`}
            </p>
            <h1 className="mt-1 text-h1 [overflow-wrap:anywhere]">
              {t('title', { brand: p.brand })}
            </h1>
            <p className="mt-2 text-body text-text-muted">
              {t('intro', {
                company: locale === 'ar' ? p.company.legalNameAr : p.company.legalNameEn,
              })}
            </p>
            {p.validUntil && (p.status === 'sent' || p.status === 'viewed') && (
              <p className="mt-2 text-body-sm font-semibold">
                {t('validUntil', { day: p.validUntil })}
              </p>
            )}

            <section
              aria-labelledby="rates"
              className="mt-6 rounded-lg border border-line bg-surface p-4"
            >
              <h2 id="rates" className="text-h3">
                {t('ratesTitle')}
              </h2>
              <p className="mt-1 text-caption text-text-muted">
                {p.vatBp > 0 ? t('vatAdded', { vat: pct(p.vatBp) }) : t('vatNone')}
              </p>
              <dl className="mt-2 text-body-sm">
                {shipping > 0 &&
                  row(
                    t('shippingFee'),
                    <span className="font-bold">{egp(shipping)}</span>,
                    t('shippingFeeHint'),
                  )}
                {row(
                  t('orderFee'),
                  orIncluded(
                    p.fees.orderFixedPiastres + p.fees.orderPercentBp,
                    p.fees.orderPercentBp > 0
                      ? t('orderFeeBoth', {
                          fixed: egp(p.fees.orderFixedPiastres),
                          percent: pct(p.fees.orderPercentBp),
                        })
                      : egp(p.fees.orderFixedPiastres),
                  ),
                  t('orderFeeHint'),
                )}
                {row(
                  t('codFee'),
                  orIncluded(
                    p.fees.codPercentBp,
                    t('codFeeValue', { percent: pct(p.fees.codPercentBp) }),
                  ),
                  t('codFeeHint'),
                )}
                {row(
                  t('failedFee'),
                  p.failedDeliveryPercentBp !== null
                    ? t('failedPercentValue', { percent: pct(p.failedDeliveryPercentBp) })
                    : egp(p.fees.failedDeliveryPiastres),
                  p.failedDeliveryPercentBp !== null ? t('failedPercentHint') : t('failedFeeHint'),
                )}
                {row(
                  t('receivingFee'),
                  orIncluded(
                    p.fees.receivingPerUnitPiastres,
                    t('perUnit', { amount: egp(p.fees.receivingPerUnitPiastres) }),
                  ),
                )}
                {row(
                  t('storageFee'),
                  orIncluded(
                    p.fees.storagePerUnitMonthPiastres,
                    t('perUnitMonth', { amount: egp(p.fees.storagePerUnitMonthPiastres) }),
                  ),
                  t('storageFeeHint'),
                )}
                {row(
                  t('returnFee'),
                  orIncluded(
                    p.fees.returnPerUnitPiastres,
                    t('perUnit', { amount: egp(p.fees.returnPerUnitPiastres) }),
                  ),
                )}
                {row(
                  t('packagingFee'),
                  p.fees.packagingChargePiastres > 0
                    ? t('perShipment', { amount: egp(p.fees.packagingChargePiastres) })
                    : t('packagingIncluded'),
                )}
              </dl>
              {p.productPrices.length > 0 && (
                <>
                  <h3 className="mt-4 text-body font-bold">{t('productPricesTitle')}</h3>
                  <p className="text-caption text-text-muted">{t('productPricesHint')}</p>
                  <ul className="mt-2 divide-y divide-line rounded-md border border-line text-body-sm">
                    {p.productPrices.map((r) => (
                      <li key={r.sku} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          <span className="ltr-iso font-semibold">{r.sku}</span>
                          {r.name && <span className="text-text-muted"> · {r.name}</span>}
                        </span>
                        <span className="shrink-0 font-bold">
                          {t('perUnit', { amount: egp(r.pricePiastres) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {p.tiers.length > 0 && (
                <>
                  <h3 className="mt-4 text-body font-bold">{t('tiersTitle')}</h3>
                  <p className="text-caption text-text-muted">{t('tiersHint')}</p>
                  <ul className="mt-2 space-y-1 text-body-sm">
                    {p.tiers.map((tier) => (
                      <li key={tier.fromOrder}>
                        {t('tierLine', {
                          from: formatCount(tier.fromOrder),
                          fee: CONTRACT_PRICE_KEYS.filter((k) => tierValue(tier, k) !== null)
                            .map((k) => {
                              const value = tierValue(tier, k)!;
                              return `${t(`tierFees.${k}`)} ${CONTRACT_PRICES[k].unit === 'bp' ? pct(value) : egp(value)}`;
                            })
                            .join(' · '),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {p.parcels && (
              <section
                aria-labelledby="parcels"
                className="mt-6 rounded-lg border border-line bg-surface p-4"
              >
                <h2 id="parcels" className="text-h3">
                  {t('parcelsTitle')}
                </h2>
                <p className="mt-1 text-body-sm text-text-muted">{t('parcelsIntro')}</p>
                <dl className="mt-3 space-y-2 text-body-sm">
                  {(
                    [
                      ['parcelsDiscount', p.parcels.discountBp],
                      ['parcelsCodFee', p.parcels.codFeeBp],
                      ['parcelsReturnFee', p.parcels.returnFeeBp],
                    ] as const
                  ).map(([label, bp]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <dt>{t(label)}</dt>
                      <dd className="font-bold">{bp === null ? t('parcelsStandard') : pct(bp)}</dd>
                    </div>
                  ))}
                </dl>
                {(p.parcels.prices ?? []).length > 0 && (
                  <dl className="mt-3 grid gap-1 text-body-sm">
                    {(p.parcels.prices ?? []).map((x) => (
                      <div
                        key={`${x.zoneCode}/${x.size}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <dt>
                          <span className="ltr-iso">{x.zoneCode}</span> · {x.size}
                        </dt>
                        <dd className="ltr-iso font-bold">{egp(x.pricePiastres)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}

            {(p.zonePrices ?? []).length > 0 && (
              <section aria-labelledby="zones" className="mt-6 rounded-lg border border-line p-4">
                <h2 id="zones" className="text-h3">
                  {t('zonesTitle')}
                </h2>
                <p className="mt-1 text-body-sm text-text-muted">{t('zonesIntro')}</p>
                <dl className="mt-3 grid gap-1 text-body-sm">
                  {(p.zonePrices ?? []).map((z) => (
                    <div key={z.id} className="flex items-center justify-between gap-2">
                      <dt>{locale === 'ar' ? z.nameAr : z.nameEn}</dt>
                      <dd className="ltr-iso font-bold">{egp(z.pricePiastres)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {p.example.orders > 0 && (
              <section
                aria-labelledby="example"
                className="mt-6 rounded-lg bg-hero p-4 text-hero-ink"
              >
                <h2 id="example" className="text-h3">
                  {t('exampleTitle')}
                </h2>
                <p className="mt-1 text-body-sm">
                  {p.averageOrderPiastres
                    ? t('exampleIntro', {
                        orders: formatCount(p.example.orders),
                        average: egp(p.averageOrderPiastres),
                      })
                    : t('exampleIntroNoAverage', { orders: formatCount(p.example.orders) })}
                </p>
                <dl className="mt-3 grid gap-3 text-body-sm sm:grid-cols-2">
                  {p.example.shippingFeesPiastres > 0 && (
                    <div>
                      <dt>{t('exampleShipping')}</dt>
                      <dd className="text-h3 tabular">{egp(p.example.shippingFeesPiastres)}</dd>
                    </div>
                  )}
                  {p.example.packagingChargesPiastres > 0 && (
                    <div>
                      <dt>{t('examplePackaging')}</dt>
                      <dd className="text-h3 tabular">{egp(p.example.packagingChargesPiastres)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('exampleOrderFees')}</dt>

                    <dd className="text-h3 tabular">{egp(p.example.orderFeesPiastres)}</dd>
                  </div>
                  <div>
                    <dt>{t('exampleCodFees')}</dt>
                    <dd className="text-h3 tabular">{egp(p.example.codFeesPiastres)}</dd>
                  </div>
                  {p.example.minimumTopUpPiastres > 0 && (
                    <div>
                      <dt>{t('exampleMinimum')}</dt>
                      <dd className="text-h3 tabular">{egp(p.example.minimumTopUpPiastres)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('exampleTotal')}</dt>
                    <dd className="text-h2 tabular text-hero-accent">
                      {egp(p.example.totalPiastres)}
                    </dd>
                    {p.example.perOrderPiastres !== null && (
                      <dd className="text-caption">
                        {t('examplePerOrder', { amount: egp(p.example.perOrderPiastres) })}
                      </dd>
                    )}
                  </div>
                </dl>
                <p className="mt-3 text-caption">{t('exampleNote')}</p>
              </section>
            )}

            <section
              aria-labelledby="terms"
              className="mt-6 rounded-lg border border-line bg-surface p-4"
            >
              <h2 id="terms" className="text-h3">
                {t('termsTitle')}
              </h2>
              <dl className="mt-2 text-body-sm">
                {row(
                  t('start'),
                  p.contractStartDate ? (
                    <span className="ltr-iso">{p.contractStartDate}</span>
                  ) : (
                    t('startOnConfirm')
                  ),
                )}
                {row(
                  t('length'),
                  p.contractMonths ? t('months', { n: p.contractMonths }) : t('openEnded'),
                )}
                {row(t('notice'), t('days', { n: p.noticeDays }))}
                {p.minimumMonthlyFeePiastres
                  ? row(t('minimum'), egp(p.minimumMonthlyFeePiastres), t('minimumHint'))
                  : null}
                {p.securityDepositPiastres
                  ? row(t('deposit'), egp(p.securityDepositPiastres), t('depositHint'))
                  : null}
                {p.creditLimitPiastres
                  ? row(t('creditLimit'), egp(p.creditLimitPiastres), t('creditLimitHint'))
                  : null}
                {row(
                  t('payouts'),
                  p.payoutSchedule ? t(`schedules.${p.payoutSchedule}`) : t('payoutsValue'),
                )}
                {p.minimumPayoutPiastres
                  ? row(t('minimumPayout'), egp(p.minimumPayoutPiastres))
                  : null}
                {p.promiseMinutes ? row(t('promise'), t('minutes', { n: p.promiseMinutes })) : null}
                {p.deliveryAttempts ? row(t('attempts'), String(p.deliveryAttempts)) : null}
              </dl>
              {p.terms && <p className="mt-3 whitespace-pre-line text-body-sm">{p.terms}</p>}
            </section>

            <section aria-labelledby="who" className="mt-6 text-body-sm text-text-muted">
              <h2 id="who" className="sr-only">
                {t('whoTitle')}
              </h2>
              <p>
                {locale === 'ar' ? p.company.legalNameAr : p.company.legalNameEn}
                {p.company.taxRegistrationNumber &&
                  ` · ${t('taxNumber', { n: p.company.taxRegistrationNumber })}`}
                {p.company.address && ` · ${p.company.address}`}
              </p>
              {p.rep && (
                <p className="mt-1">
                  {t('rep', { name: p.rep.name })}{' '}
                  <a href={`mailto:${p.rep.email}`} className="ltr-iso text-link">
                    {p.rep.email}
                  </a>
                  {p.rep.phone && (
                    <>
                      {' · '}
                      <a href={`tel:${p.rep.phone}`} className="ltr-iso text-link">
                        {p.rep.phone}
                      </a>
                    </>
                  )}
                </p>
              )}
            </section>

            <div className="mt-6">
              {p.status === 'accepted' && p.acceptedAt ? (
                <p
                  role="status"
                  className="rounded-lg border border-success bg-surface p-4 text-body"
                >
                  {t('accepted', {
                    name: p.signerName ?? '',
                    title: p.signerTitle ?? '',
                    when: formatCairoDateTime(p.acceptedAt, locale),
                  })}
                </p>
              ) : p.status === 'declined' ? (
                <p role="status" className="rounded-lg border border-line bg-surface p-4 text-body">
                  {t('declined')}
                </p>
              ) : p.status === 'expired' ? (
                <p
                  role="status"
                  className="rounded-lg border border-danger bg-surface p-4 text-body"
                >
                  {t('expired')}
                </p>
              ) : p.status === 'superseded' ? (
                <p role="status" className="rounded-lg border border-line bg-surface p-4 text-body">
                  {t('superseded')}
                </p>
              ) : (
                <ProposalAnswer token={token} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
