import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { type BankDetails, BankDetailsForm } from '@/components/finance/BankDetailsForm';
import { EmailSettingsForm } from '@/components/merchant/EmailSettingsForm';
import { PayoutScheduleForm } from '@/components/merchant/PayoutScheduleForm';
import { WalletCard } from '@/components/WalletCard';
import { StatementView } from '@/components/finance/StatementView';
import { apiGet, getMerchantRights } from '@/lib/api-server';
import type { PayoutSchedule, Statement } from '@/lib/finance-types';
import { formatCairoDateTime, formatCutoffDay, formatEgp } from '@/lib/format';
import type { MerchantEmailSettings } from '@/lib/purchasing-types';
import { StatusPill } from '@/components/StatusPill';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface Wallet {
  owedPiastres: number;
  payoutSchedule: PayoutSchedule;
  payouts: {
    id: string;
    cutoffAt: string;
    amountPiastres: number;
    status: 'draft' | 'paid';
    reference: string | null;
    paidAt: string | null;
    soa: { number: string; netPiastres: number } | null;
    pot: { number: string; amountPiastres: number; reference: string; contentType: string } | null;
    paidByCheque: boolean;
    matches: boolean;
  }[];
}

export default async function MerchantWalletPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : addDays(today, -29);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const query = new URLSearchParams({ from, to });
  const [wallet, bank, statement, emails, rights, t, tf, te, locale] = await Promise.all([
    apiGet<Wallet>('/merchant/finance'),
    apiGet<BankDetails>('/merchant/finance/bank'),
    apiGet<Statement>(`/merchant/finance/statement?${query}`),
    apiGet<MerchantEmailSettings>('/merchant/email-settings'),
    getMerchantRights(),
    getTranslations('merchantFinance'),
    getTranslations('finance'),
    getTranslations('purchasing.emailSettings'),
    getLocale(),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <WalletCard
          large
          icon={wallet.owedPiastres < 0 ? 'invoice' : 'wallet'}
          label={wallet.owedPiastres < 0 ? t('owes') : t('owed')}
          value={t('amount', { amount: formatEgp(Math.abs(wallet.owedPiastres)) })}
          hint={t('schedule', { schedule: tf(`schedules.${wallet.payoutSchedule}`) })}
        />
        <div className="rounded-lg border border-line bg-surface p-5">
          <PayoutScheduleForm schedule={wallet.payoutSchedule} />
          <p className="mt-3 text-caption text-text-muted">{t('scheduleHint')}</p>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-h3">{tf('bankDetails.title')}</h2>
        <p className="mb-3 text-caption text-text-muted">{tf('bankDetails.merchantHint')}</p>
        <BankDetailsForm details={bank} path="/merchant/finance/bank" />
      </section>

      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-h3">{te('title')}</h2>
        <p className="mb-3 text-caption text-text-muted">{te('hint')}</p>
        <EmailSettingsForm
          settings={emails}
          path="/merchant/email-settings"
          readOnly={!rights?.owner && !rights?.rights.includes('settings')}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('payouts')}</h2>
        {wallet.payouts.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noPayouts')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {wallet.payouts.map((p) => (
              <li key={p.id} className="space-y-3 px-4 py-3 text-body-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {/* Merchants see a draft, approved or not, as Being prepared. */}
                    <StatusPill status={p.status}>
                      {p.status === 'paid' ? t('paid') : t('waiting')}
                    </StatusPill>
                    <span className="ltr-iso block text-caption text-text-muted">
                      {p.paidAt
                        ? formatCairoDateTime(p.paidAt, locale)
                        : formatCutoffDay(p.cutoffAt, locale)}
                    </span>
                    {p.reference && (
                      <span className="ltr-iso block text-caption text-text-muted">
                        {t('reference', { reference: p.reference })}
                      </span>
                    )}
                  </span>
                  <span className="text-h3">
                    <Amount piastres={p.amountPiastres} /> {tf('egp')}
                  </span>
                </div>
                {/* The statement of account and the proof of transfer side by side. */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-line p-2">
                    <p className="text-caption text-text-muted">{t('soa')}</p>
                    {p.soa ? (
                      <>
                        <p className="ltr-iso font-bold">{p.soa.number}</p>
                        <p>
                          <Amount piastres={p.soa.netPiastres} /> {tf('egp')}
                        </p>
                        <p className="flex flex-wrap gap-3 text-caption">
                          <Link
                            className="font-bold text-link"
                            href={`/merchant/wallet/payouts/${p.id}`}
                          >
                            {t('viewSoa')}
                          </Link>
                          <a
                            className="font-bold text-link"
                            href={`/api/merchant/finance/payouts/${p.id}/statement.pdf?lang=${locale === 'ar' ? 'ar' : 'en'}`}
                          >
                            {t('pdf')}
                          </a>
                        </p>
                      </>
                    ) : (
                      <p className="text-caption text-text-muted">{t('potWaiting')}</p>
                    )}
                  </div>
                  <div className="rounded-md border border-line p-2">
                    <p className="text-caption text-text-muted">{t('pot')}</p>
                    {p.pot ? (
                      <>
                        <p className="ltr-iso font-bold">{p.pot.number}</p>
                        <p>
                          <Amount piastres={p.pot.amountPiastres} /> {tf('egp')}
                        </p>
                        <a
                          className="text-caption font-bold text-link"
                          href={`/api/merchant/finance/payouts/${p.id}/proof`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('viewSlip')}
                        </a>
                      </>
                    ) : (
                      <p className="text-caption text-text-muted">
                        {p.paidByCheque ? t('byCheque') : t('potWaiting')}
                      </p>
                    )}
                  </div>
                  <div
                    className={`rounded-md border p-2 ${p.matches ? 'border-status-delivered' : 'border-line'}`}
                  >
                    {p.matches ? (
                      <>
                        <p className="font-bold">✓ {t('matches')}</p>
                        <p className="text-caption text-text-muted">{t('matchesHint')}</p>
                      </>
                    ) : (
                      <p className="text-caption text-text-muted">
                        {p.status === 'paid' && !p.paidByCheque ? t('differs') : t('potWaiting')}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('statement')}</h2>
        <StatementView
          statement={statement}
          from={from}
          to={to}
          exportHref={`/api/merchant/finance/statement/export.csv?${query}`}
        />
      </section>
    </>
  );
}
