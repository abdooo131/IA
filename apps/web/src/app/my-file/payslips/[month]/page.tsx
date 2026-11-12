import { employeeCode } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { translatorIn } from '@/i18n/fixed-locale';
import Link from 'next/link';
import { Fragment } from 'react';
import { Amount } from '@/components/finance/Amount';
import { PrintButton } from '@/components/finance/PrintButton';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';
import { formatMonth } from '@/lib/my-pay';
import type { MyPayslip } from '@/lib/my-pay-types';

export const dynamic = 'force-dynamic';

/**
 * One of my payslips, printable (the menu is left out) in English or Arabic whatever the
 * screen's language (?lang=en|ar): gross with the salary's parts, bonuses, every deduction
 * (insurance, tax, martyrs fund, unpaid days, violations, advance taken back), net and the bank
 * or cash box it was paid from. The API answers only the signed in person's own payslip.
 */
export default async function MyPayslipPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ month }, q, screen] = await Promise.all([params, searchParams, getLocale()]);
  const lang = q.lang === 'ar' || q.lang === 'en' ? q.lang : screen;
  const [slip, t, ts] = await Promise.all([
    apiGet<MyPayslip>(`/me/payslips/${encodeURIComponent(month)}`),
    translatorIn(lang === 'ar' ? 'ar' : 'en', 'myPay'),
    getTranslations('myPay'),
  ]);
  const name = (x: { nameEn: string; nameAr: string | null } | null | undefined) =>
    x ? (lang === 'ar' ? x.nameAr || x.nameEn : x.nameEn) : null;
  const e = slip.employee;
  const row = (label: string, value: number, strong = false) => (
    <tr className="border-t border-line">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-end">
        <Amount piastres={value} strong={strong} />
      </td>
    </tr>
  );
  const allowance = (a: MyPayslip['allowances'][number]) =>
    a.label || (t.has(`allowances.${a.kind}`) ? t(`allowances.${a.kind}`) : a.kind);
  return (
    <MyHrFrame current="/my-file/payslips" title={ts('payslipTitle')}>
      <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href="/my-file/payslips"
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm"
        >
          {ts('back')}
        </Link>
        <Link
          href={`/my-file/payslips/${month}?lang=en`}
          aria-current={lang === 'en' ? 'page' : undefined}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm"
        >
          English
        </Link>
        <Link
          href={`/my-file/payslips/${month}?lang=ar`}
          aria-current={lang === 'ar' ? 'page' : undefined}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm"
        >
          العربية
        </Link>
        <PrintButton />
      </div>
      <article
        lang={lang}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        className="mt-4 max-w-2xl break-inside-avoid rounded-lg border border-line bg-surface p-5 text-body-sm print:border-0 print:p-0"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-caption uppercase text-text-muted">{t('slipHeading')}</p>
            <h2 className="text-h3">{formatMonth(slip.month, lang)}</h2>
          </div>
          <div className="text-end">
            <p className="font-bold">{name(e) ?? slip.name}</p>
            {e && <p className="ltr-iso text-caption text-text-muted">{employeeCode(e.number)}</p>}
          </div>
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
          {e?.position && (
            <>
              <dt className="text-text-muted">{t('position')}</dt>
              <dd>
                {lang === 'ar' ? e.position.titleAr || e.position.titleEn : e.position.titleEn}
              </dd>
            </>
          )}
          {e?.department && (
            <>
              <dt className="text-text-muted">{t('department')}</dt>
              <dd>{name(e.department)}</dd>
            </>
          )}
          {e?.homeStore && (
            <>
              <dt className="text-text-muted">{t('store')}</dt>
              <dd>{name(e.homeStore)}</dd>
            </>
          )}
          {e?.nationalId && (
            <>
              <dt className="text-text-muted">{t('nationalId')}</dt>
              <dd className="ltr-iso">{e.nationalId}</dd>
            </>
          )}
          {e?.socialInsuranceNumber && (
            <>
              <dt className="text-text-muted">{t('insuranceNumber')}</dt>
              <dd className="ltr-iso">{e.socialInsuranceNumber}</dd>
            </>
          )}
          <dt className="text-text-muted">{t('voucher')}</dt>
          <dd className="ltr-iso">{slip.entryNumber}</dd>
          <dt className="text-text-muted">{t('paidAt')}</dt>
          <dd>{formatCairoDateTime(slip.paidAt, lang)}</dd>
          {slip.paidFrom && (
            <>
              <dt className="text-text-muted">{t('paidFrom')}</dt>
              <dd>
                <span className="ltr-iso">{slip.paidFrom.code}</span>{' '}
                {lang === 'ar' ? slip.paidFrom.nameAr : slip.paidFrom.nameEn}
              </dd>
            </>
          )}
        </dl>

        <h3 className="mt-5 text-body font-bold">{t('earnings')}</h3>
        <table className="mt-1 w-full">
          <tbody>
            {slip.basic !== null ? (
              <>
                {row(t('basic'), slip.basic)}
                {slip.allowances.map((a, i) => (
                  <Fragment key={i}>{row(allowance(a), a.amountPiastres)}</Fragment>
                ))}
              </>
            ) : (
              row(t('salary'), slip.base)
            )}
            {slip.bonus > 0 && row(t('bonus'), slip.bonus)}
            {slip.commission > 0 && row(t('commission'), slip.commission)}
            {slip.deduction > 0 && row(t('deduction'), -slip.deduction)}
            {slip.hrItems.map((i, n) => (
              <Fragment key={n}>
                {row(
                  i.kind === 'unpaid_leave'
                    ? t('unpaidDays', { label: i.label })
                    : t('violationDeduction', { label: i.label }),
                  -i.amountPiastres,
                )}
              </Fragment>
            ))}
            {row(t('gross'), slip.gross, true)}
          </tbody>
        </table>

        <h3 className="mt-5 text-body font-bold">{t('deductions')}</h3>
        <table className="mt-1 w-full">
          <tbody>
            {row(t('insurance', { wage: (slip.insuredWage / 100).toFixed(2) }), -slip.siEmployee)}
            {row(t('incomeTax'), -slip.incomeTax)}
            {row(t('martyrs'), -slip.martyrs)}
            {slip.recovery > 0 && row(t('advance'), -slip.recovery)}
            {row(t('net'), slip.net, true)}
          </tbody>
        </table>
        <p className="mt-3 text-caption text-text-muted">
          {t('companyShare', { amount: (slip.siEmployer / 100).toFixed(2) })}
        </p>
        {slip.note && <p className="mt-2 text-caption">{slip.note}</p>}
      </article>
    </MyHrFrame>
  );
}
