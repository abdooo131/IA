import { addDays, cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Amount } from '@/components/finance/Amount';
import { CorporateTaxForm } from '@/components/finance/CorporateTaxForm';
import { PrintButton } from '@/components/finance/PrintButton';
import { apiGet } from '@/lib/api-server';
import type { CorporateTax, PayrollForms, VatReturn, WithholdingRow } from '@/lib/finance-types';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

function Section({
  title,
  hint,
  controls,
  children,
}: {
  title: string;
  hint: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="break-inside-avoid space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-h3">{title}</h2>
        {controls}
      </div>
      <p className="text-caption text-text-muted">{hint}</p>
      {children}
    </section>
  );
}

function Box({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className="border-t border-line">
      <td className="py-2">{label}</td>
      <td className="py-2 text-end">
        <Amount piastres={value} strong={strong} />
      </td>
    </tr>
  );
}

/** The Tax returns tab of Taxes: monthly VAT, quarterly withholding, payroll forms, income tax. */
export async function ReturnsTab({
  q,
}: {
  q: { month?: string; year?: string; quarter?: string; taxYear?: string };
}) {
  const today = cairoDay(new Date());
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : lastMonth;
  const year = q.year && /^\d{4}$/.test(q.year) ? q.year : today.slice(0, 4);
  const quarter =
    q.quarter && /^[1-4]$/.test(q.quarter)
      ? q.quarter
      : String(Math.ceil(Number(today.slice(5, 7)) / 3));
  const taxYear =
    q.taxYear && /^\d{4}$/.test(q.taxYear) ? q.taxYear : String(Number(today.slice(0, 4)) - 1);
  const [vat, wht, payroll, corporate, t] = await Promise.all([
    apiGet<VatReturn>(`/finance/tax-returns/vat?month=${month}`),
    apiGet<WithholdingRow[]>(`/finance/tax-returns/withholding?year=${year}&quarter=${quarter}`),
    apiGet<PayrollForms>(`/finance/tax-returns/payroll?month=${month}`),
    apiGet<CorporateTax>(`/finance/tax-returns/corporate?year=${taxYear}`),
    getTranslations('finance.returns'),
  ]);
  const monthForm = (
    <form className="flex items-end gap-2 print:hidden">
      <input type="hidden" name="tab" value="returns" />
      <input
        type="month"
        name="month"
        defaultValue={month}
        dir="ltr"
        className="h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
      />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="quarter" value={quarter} />
      <button className="h-10 rounded-md border border-line px-3 text-body-sm font-bold">
        {t('show')}
      </button>
    </form>
  );
  const totalWht = wht.reduce((s, r) => s + r.whtPiastres, 0);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">{t('title')}</h2>
        <PrintButton />
      </div>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <div className="mt-4 space-y-6">
        <Section title={t('vatTitle', { month })} hint={t('vatHint')} controls={monthForm}>
          <table className="w-full max-w-xl text-body-sm">
            <tbody>
              <Box label={t('sales')} value={vat.salesPiastres} />
              <Box label={t('outputVat')} value={vat.outputVatPiastres} />
              {(vat.debitNotesPiastres ?? 0) !== 0 && (
                <>
                  <Box label={t('debitNotes')} value={vat.debitNotesPiastres ?? 0} />
                  <Box label={t('debitNoteVat')} value={vat.debitNoteVatPiastres ?? 0} />
                </>
              )}
              <Box label={t('creditNotes')} value={-vat.creditNotesPiastres} />
              <Box label={t('creditNoteVat')} value={-vat.creditNoteVatPiastres} />
              <Box label={t('purchases')} value={vat.purchasesPiastres} />
              <Box label={t('inputVat')} value={-vat.inputVatPiastres} />
              <Box label={t('carriedIn')} value={-vat.carriedInPiastres} />
              <Box label={t('due')} value={vat.duePiastres} strong />
              <Box label={t('carriedOut')} value={vat.carriedOutPiastres} />
            </tbody>
          </table>
        </Section>

        <Section
          title={t('whtTitle', { quarter, year })}
          hint={t('whtHint')}
          controls={
            <a
              href={`/api/finance/tax-returns/withholding.csv?year=${year}&quarter=${quarter}`}
              className="h-10 content-center rounded-md border border-line px-3 text-body-sm font-bold print:hidden"
            >
              {t('downloadCsv')}
            </a>
          }
        >
          {wht.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('none')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr>
                    <th className={th}>{t('taxId')}</th>
                    <th className={th}>{t('name')}</th>
                    <th className={th}>{t('date')}</th>
                    <th className={`${th} text-end`}>{t('beforeVat')}</th>
                    <th className={`${th} text-end`}>{t('rate')}</th>
                    <th className={`${th} text-end`}>{t('withheld')}</th>
                  </tr>
                </thead>
                <tbody>
                  {wht.map((r) => (
                    <tr key={r.entryNumber} className="border-t border-line">
                      <td className={`${td} ltr-iso`}>
                        {r.taxId || <span className="text-danger">{t('noTaxId')}</span>}
                      </td>
                      <td className={td}>{r.supplier}</td>
                      <td className={`${td} ltr-iso`}>{r.day}</td>
                      <td className={`${td} text-end`}>
                        <Amount piastres={r.netPiastres} />
                      </td>
                      <td className={`${td} text-end ltr-iso`}>{(r.rateBp / 100).toFixed(2)}%</td>
                      <td className={`${td} text-end`}>
                        <Amount piastres={r.whtPiastres} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-bold">
                    <td className={td} colSpan={5}>
                      {t('total')}
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={totalWht} strong />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title={t('payrollTitle', { month })}
          hint={t('payrollHint')}
          controls={
            <span className="flex gap-2 print:hidden">
              <a
                href={`/api/finance/tax-returns/payroll.csv?month=${month}&kind=tax`}
                className="h-10 content-center rounded-md border border-line px-3 text-body-sm font-bold"
              >
                {t('salaryTaxCsv')}
              </a>
              <a
                href={`/api/finance/tax-returns/payroll.csv?month=${month}&kind=insurance`}
                className="h-10 content-center rounded-md border border-line px-3 text-body-sm font-bold"
              >
                {t('insuranceCsv')}
              </a>
            </span>
          }
        >
          {payroll.rows.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('noRun')}</p>
          ) : (
            <>
              {payroll.missingIds > 0 && (
                <p className="text-body-sm text-danger">
                  {t('missingIds', { count: payroll.missingIds })}
                </p>
              )}
              <table className="w-full max-w-xl text-body-sm">
                <tbody>
                  <Box label={t('gross')} value={payroll.totals.grossPiastres} />
                  <Box label={t('incomeTax')} value={payroll.totals.incomeTaxPiastres} strong />
                  <Box label={t('insuredWages')} value={payroll.totals.insuredWagesPiastres} />
                  <Box label={t('siEmployee')} value={payroll.totals.siEmployeePiastres} />
                  <Box label={t('siEmployer')} value={payroll.totals.siEmployerPiastres} />
                  <Box
                    label={t('siTotal')}
                    value={payroll.totals.siEmployeePiastres + payroll.totals.siEmployerPiastres}
                    strong
                  />
                  <Box label={t('martyrs')} value={payroll.totals.martyrsPiastres} strong />
                </tbody>
              </table>
            </>
          )}
        </Section>

        <Section
          title={t('corporateTitle', { year: taxYear })}
          hint={t('corporateHint')}
          controls={
            <form className="flex items-end gap-2 print:hidden">
              <input type="hidden" name="tab" value="returns" />
              <input
                name="taxYear"
                defaultValue={taxYear}
                inputMode="numeric"
                dir="ltr"
                className="h-10 w-24 rounded-md border border-line bg-surface px-2 text-body-sm"
              />
              <button className="h-10 rounded-md border border-line px-3 text-body-sm font-bold">
                {t('show')}
              </button>
            </form>
          }
        >
          <table className="w-full max-w-xl text-body-sm">
            <tbody>
              <Box label={t('profitBeforeTax')} value={corporate.profitBeforeTaxPiastres} />
              <tr className="border-t border-line">
                <td className="py-2">{t('rateIs')}</td>
                <td className="py-2 text-end ltr-iso">{(corporate.rateBp / 100).toFixed(2)}%</td>
              </tr>
              <Box label={t('estimate')} value={corporate.estimatePiastres} strong />
              <Box label={t('booked')} value={corporate.bookedPiastres} />
            </tbody>
          </table>
          <CorporateTaxForm tax={corporate} />
        </Section>
      </div>
    </>
  );
}
