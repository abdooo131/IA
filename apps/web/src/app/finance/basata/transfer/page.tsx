import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BasataSettlementForm } from '@/components/finance/BasataSettlementForm';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type { BasataSettlementForm as FormData } from '@/lib/basata';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * Record Basata transfer: Basata's daily transfer reached the bank less its fee. Finance picks
 * the approved deposits it covers; the bank line is then matched on Match the bank as usual.
 */
export default async function BasataTransferPage() {
  const [data, t, locale] = await Promise.all([
    apiGet<FormData>('/finance/basata/settlements/new'),
    getTranslations('basata.transfer'),
    getLocale(),
  ]);
  return (
    <>
      <Link href="/finance/basata" className="text-body-sm font-semibold text-link">
        {t('back')}
      </Link>
      <h1 className="mt-2 text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <BasataSettlementForm data={data} today={cairoDay(new Date())} />

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-h3">{t('recent')}</h2>
        {data.recent.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noRecent')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-body-sm">
              <thead>
                <tr className="border-b border-line text-caption text-text-muted">
                  <th className="py-2 text-start">{t('number')}</th>
                  <th className="py-2 text-start">{t('day')}</th>
                  <th className="py-2 text-start">{t('bank')}</th>
                  <th className="py-2 text-end">{t('depositAmount')}</th>
                  <th className="py-2 text-end">{t('amount')}</th>
                  <th className="py-2 text-end">{t('fee')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((s) => (
                  <tr key={s.id} className="border-b border-line">
                    <td className="ltr-iso py-2">
                      <Link href={`/finance/journal/${s.entry.id}`} className="text-link">
                        {s.number}
                      </Link>
                    </td>
                    <td className="ltr-iso py-2">{isoToDayFirst(s.receivedOn)}</td>
                    <td className="py-2">
                      {s.bank.code} ·{' '}
                      {localized(
                        { nameEn: s.bank.nameEn ?? s.bank.code, nameAr: s.bank.nameAr ?? '' },
                        locale,
                      ) || s.bank.nameEn}
                    </td>
                    <td className="ltr-iso py-2 text-end">{formatEgp(s.depositsPiastres)}</td>
                    <td className="ltr-iso py-2 text-end">{formatEgp(s.amountPiastres)}</td>
                    <td className="ltr-iso py-2 text-end">{formatEgp(s.feePiastres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
