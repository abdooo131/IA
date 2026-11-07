'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import type { RiderWalletRow } from '@/lib/rider-wallet';
import { Amount } from './Amount';

/**
 * Every rider's wallet (CLAUDE.md "Rider pay"): the cash they carry, what they earned and have
 * not been paid, what is on hold, what they owe and what they may withdraw now. Payments go
 * through the rider's withdrawal requests (Rider withdrawals), never from here.
 */
export function RiderWallets({ riders }: { riders: RiderWalletRow[] }) {
  const t = useTranslations('finance.riders');
  const tp = useTranslations('riderPay');
  const locale = useLocale();
  return (
    <>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {tp('ridersIntro')}{' '}
        <Link href="/finance/rider-withdrawals" className="font-semibold text-link">
          {tp('financeTitle')}
        </Link>
      </p>
      <ul className="mt-4 space-y-3">
        {riders.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="font-bold">
              {r.name} (<span className="ltr-iso">{r.badgeCode}</span>)
            </p>
            <p className="text-caption text-text-muted">{localized(r.darkStore, locale)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <dt className="text-caption text-text-muted">{t('cash')}</dt>
                <dd className="font-bold">
                  <Amount piastres={r.cashPiastres} />
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{tp('balance')}</dt>
                <dd className="font-bold">
                  <Amount piastres={r.wallet.balancePiastres} />
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{tp('onHold')}</dt>
                <dd className="font-bold">
                  <Amount piastres={r.wallet.onHoldPiastres} />
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{tp('owed')}</dt>
                <dd className="font-bold">
                  <Amount piastres={r.wallet.owedPiastres} />
                </dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">{tp('available')}</dt>
                <dd className="font-bold">
                  <Amount piastres={r.wallet.availablePiastres} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
