import { getLocale, getTranslations } from 'next-intl/server';
import type { InvoiceDetail } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';

/** A tax invoice or credit note as printed (both languages' names, amounts in EGP). */
export async function InvoiceView({ invoice }: { invoice: InvoiceDetail }) {
  const t = await getTranslations('finance.invoices');
  const locale = await getLocale();
  const c = invoice.company;
  const ar = locale === 'ar';
  return (
    <article className="mt-4 max-w-3xl rounded-lg border border-line bg-surface p-6 text-body-sm print:mt-0 print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-h3">
            {ar ? c.legalNameAr || c.legalNameEn : c.legalNameEn || c.legalNameAr}
          </p>
          <p className="text-text-muted">
            {[c.street, c.buildingNumber, c.regionCity, c.governorate].filter(Boolean).join(', ')}
          </p>
          <p>
            {t('taxNumber')}: <span className="ltr-iso">{c.taxRegistrationNumber || '-'}</span>
          </p>
        </div>
        <div className="text-end">
          <p className="text-h2">
            {invoice.type === 'invoice' ? t('taxInvoice') : t('creditNote')}
          </p>
          <p className="ltr-iso text-h3">{invoice.label}</p>
          <p>{formatCairoDateTime(invoice.issuedAt, locale)}</p>
          {invoice.periodMonth && (
            <p>
              {t('forMonth', { month: '' })}
              <span className="ltr-iso">{invoice.periodMonth}</span>
            </p>
          )}
          {invoice.original && <p>{t('against', { number: invoice.original })}</p>}
        </div>
      </header>
      <section className="border-b border-line py-4">
        <p className="text-label uppercase text-text-muted">{t('billTo')}</p>
        <p className="font-bold">{invoice.receiver.name}</p>
        {invoice.receiver.address && <p>{invoice.receiver.address}</p>}
        <p>
          {t('taxNumber')}:{' '}
          <span className="ltr-iso">{invoice.receiver.taxRegistrationNumber || '-'}</span>
        </p>
        {invoice.reason && <p className="mt-2">{t('reasonIs', { reason: invoice.reason })}</p>}
      </section>
      <table className="mt-4 w-full">
        <thead>
          <tr className="text-label uppercase text-text-muted">
            <th className="py-2 text-start">{t('item')}</th>
            <th className="py-2 text-end">{t('quantity')}</th>
            <th className="py-2 text-end">{t('net')}</th>
            <th className="py-2 text-end">{t('vat')}</th>
            <th className="py-2 text-end">{t('total')}</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="border-t border-line">
              <td className="py-2">{ar ? l.descriptionAr : l.descriptionEn}</td>
              <td className="py-2 text-end">{l.quantity}</td>
              <td className="py-2 text-end">
                <Amount piastres={l.netPiastres} />
              </td>
              <td className="py-2 text-end">
                <Amount piastres={l.vatPiastres} />
              </td>
              <td className="py-2 text-end">
                <Amount piastres={l.netPiastres + l.vatPiastres} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td className="py-2" colSpan={2} />
            <td className="py-2 text-end">
              <Amount piastres={invoice.netPiastres} />
            </td>
            <td className="py-2 text-end">
              <Amount piastres={invoice.vatPiastres} />
            </td>
            <td className="py-2 text-end">
              <Amount piastres={invoice.totalPiastres} strong />
            </td>
          </tr>
        </tfoot>
      </table>
      <footer className="mt-4 border-t border-line pt-3 text-caption text-text-muted">
        {invoice.etaUuid ? (
          <p>
            {t('etaId')}: <span className="ltr-iso break-all">{invoice.etaUuid}</span>
          </p>
        ) : (
          <p>{t('notYetSent')}</p>
        )}
      </footer>
    </article>
  );
}
