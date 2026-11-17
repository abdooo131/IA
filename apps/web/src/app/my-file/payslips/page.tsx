import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { apiTry } from '@/lib/api-server';
import { formatMonth } from '@/lib/my-pay';
import type { MyPayslipList } from '@/lib/my-pay-types';

export const dynamic = 'force-dynamic';

/**
 * My payslips: one per month of a posted salary run, newest first. Riders paid per delivered
 * order have none; they are sent to their wallet.
 */
export default async function MyPayslipsPage() {
  const [data, t, locale] = await Promise.all([
    apiTry<MyPayslipList>('/me/payslips'),
    getTranslations('myPay'),
    getLocale(),
  ]);
  return (
    <MyHrFrame current="/my-file/payslips" title={t('payslipsTitle')} intro={t('payslipsIntro')}>
      {!data ? (
        <p className="mt-4 text-body text-text-muted">{t('noFile')}</p>
      ) : data.payBasis === 'per_delivery' ? (
        <section className="mt-4 rounded-lg border border-line bg-surface p-4">
          <p className="text-body">{t('perDelivery')}</p>
          <Link
            href="/rider/wallet"
            className="mt-3 inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
          >
            {t('openWallet')}
          </Link>
        </section>
      ) : data.payslips.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('noPayslips')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {data.payslips.map((s) => (
            <li key={s.month}>
              <Link
                href={`/my-file/payslips/${s.month}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface-raised"
              >
                <span>
                  <span className="block font-bold">{formatMonth(s.month, locale)}</span>
                  <span className="ltr-iso text-caption text-text-muted">{s.entryNumber}</span>
                </span>
                <span className="text-end text-body-sm">
                  <span className="block text-caption text-text-muted">{t('net')}</span>
                  <Amount piastres={s.net} strong />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MyHrFrame>
  );
}
