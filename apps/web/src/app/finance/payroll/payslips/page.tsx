import { addDays, cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { PrintButton } from '@/components/finance/PrintButton';
import { apiGet } from '@/lib/api-server';
import type { PayslipRun } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function PayslipsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const month =
    q.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)
      ? q.month
      : addDays(`${cairoDay(new Date()).slice(0, 8)}01`, -1).slice(0, 7);
  const [run, t] = await Promise.all([
    apiGet<PayslipRun>(`/finance/payslips?month=${month}`),
    getTranslations('finance.payroll'),
  ]);
  const row = (label: string, value: number, strong = false) => (
    <tr className="border-t border-line">
      <td className="py-1">{label}</td>
      <td className="py-1 text-end">
        <Amount piastres={value} strong={strong} />
      </td>
    </tr>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-h2">{t('payslipsTitle', { month })}</h1>
        <div className="flex gap-2">
          <a
            href="/finance/payroll"
            className="rounded-md border border-line px-3 py-2 text-body-sm"
          >
            {t('back')}
          </a>
          <PrintButton />
        </div>
      </div>
      {run.people.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-muted">{t('noRun')}</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 print:grid-cols-2">
          {run.people.map((p) => (
            <article
              key={p.userId}
              className="break-inside-avoid rounded-lg border border-line bg-surface p-4 text-body-sm"
            >
              <h2 className="text-h3">{p.name}</h2>
              <p className="text-caption text-text-muted">
                {t('slipFor', { month, number: run.entryNumber ?? '' })}
              </p>
              <table className="mt-2 w-full">
                <tbody>
                  {row(t('baseSalary'), p.base)}
                  {p.bonus > 0 && row(t('bonus'), p.bonus)}
                  {(p.commission ?? 0) > 0 && row(t('commission'), p.commission ?? 0)}
                  {p.deduction > 0 && row(t('deduction'), -p.deduction)}
                  {row(t('gross'), p.gross, true)}
                  {row(
                    t('insuranceOn', { amount: (p.insuredWage / 100).toFixed(2) }),
                    -p.siEmployee,
                  )}
                  {row(t('incomeTax'), -p.incomeTax)}
                  {row(t('martyrs'), -p.martyrs)}
                  {p.recovery > 0 && row(t('recovery'), -p.recovery)}
                  {row(t('net'), p.net, true)}
                </tbody>
              </table>
              <p className="mt-2 text-caption text-text-muted">
                {t('companyShare', { amount: (p.siEmployer / 100).toFixed(2) })}
              </p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
