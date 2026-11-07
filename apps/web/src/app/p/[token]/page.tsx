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
                {row(
                  t('orderFee'),
                  p.fees.orderPercentBp > 0
                    ? t('orderFeeBoth', {
                        fixed: egp(p.fees.orderFixedPiastres),
                        percent: pct(p.fees.orderPercentBp),
                      })
                    : egp(p.fees.orderFixedPiastres),
                  t('orderFeeHint'),
                )}
                {row(
                  t('codFee'),
                  t('codFeeValue', { percent: pct(p.fees.codPercentBp) }),
                  t('codFeeHint'),
                )}
                {row(t('failedFee'), egp(p.fees.failedDeliveryPiastres), t('failedFeeHint'))}
                {row(
                  t('receivingFee'),
                  t('perUnit', { amount: egp(p.fees.receivingPerUnitPiastres) }),
                )}
                {row(
                  t('storageFee'),
                  t('perUnitMonth', { amount: egp(p.fees.storagePerUnitMonthPiastres) }),
                  t('storageFeeHint'),
                )}
                {row(t('returnFee'), t('perUnit', { amount: egp(p.fees.returnPerUnitPiastres) }))}
              </dl>
              {p.tiers.length > 0 && (
                <>
                  <h3 className="mt-4 text-body font-bold">{t('tiersTitle')}</h3>
                  <p className="text-caption text-text-muted">{t('tiersHint')}</p>
                  <ul className="mt-2 space-y-1 text-body-sm">
                    {p.tiers.map((tier) => (
                      <li key={tier.fromOrder}>
                        {t('tierLine', {
                          from: formatCount(tier.fromOrder),
                          fee:
                            tier.fixedFeePiastres !== null && tier.percentBp !== null
                              ? t('orderFeeBoth', {
                                  fixed: egp(tier.fixedFeePiastres),
                                  percent: pct(tier.percentBp),
                                })
                              : tier.fixedFeePiastres !== null
                                ? egp(tier.fixedFeePiastres)
                                : t('percentOfProducts', { percent: pct(tier.percentBp!) }),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

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
                {row(t('payouts'), t('payoutsValue'))}
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
