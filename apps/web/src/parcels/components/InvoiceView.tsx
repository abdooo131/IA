'use client';
import { egp } from '@/parcels/lib/format';
import { useLocale, useT } from '@/parcels/lib/i18n';

export interface Invoice {
  id: string;
  number: string;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  month: string;
  issueDate: string;
  net: number;
  vat: number;
  total: number;
  reason: string;
  status: string;
  etaStatus: string;
  refNumber: string | null;
  lines: {
    vatBp?: number;
    items: {
      description: string;
      descriptionAr: string;
      quantity: number;
      net: number;
      vat: number;
      total: number;
    }[];
  };
  issuer: { name: string; taxId: string; address: string };
  receiver: { name: string; taxId: string; address: string; code: string };
}

/** A tax invoice or credit note laid out to print on A4, in the reader's language. */
export function InvoiceView({ inv }: { inv: Invoice }) {
  const t = useT();
  const locale = useLocale();
  const rate = (inv.lines.vatBp ?? 1400) / 100;
  return (
    <article className="rounded-xl border border-line bg-surface p-6 print:border-0 print:p-0 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <img
            src="/brand/logo-horizontal-primary.svg"
            alt="Shiply"
            className="h-8 w-auto"
            dir="ltr"
          />
          <p className="mt-3 text-body-sm font-bold">{inv.issuer.name}</p>
          <p className="text-caption text-text-muted">{inv.issuer.address}</p>
          {inv.issuer.taxId && (
            <p className="text-caption">
              {t('Tax registration')}: <span className="ltr-iso">{inv.issuer.taxId}</span>
            </p>
          )}
        </div>
        <div className="text-end">
          <p className="text-h3">
            {inv.kind === 'CREDIT_NOTE' ? t('Tax credit note') : t('Tax invoice')}
          </p>
          <p className="ltr-iso mt-1 font-bold">{inv.number}</p>
          <p className="text-caption text-text-muted">
            {t('Issued')} <span className="ltr-iso">{inv.issueDate}</span>
          </p>
          <p className="text-caption text-text-muted">
            {t('For')} <span className="ltr-iso">{inv.month}</span>
          </p>
          {inv.refNumber && (
            <p className="text-caption">
              {t('Corrects invoice')} <span className="ltr-iso">{inv.refNumber}</span>
            </p>
          )}
        </div>
      </header>
      <section className="mt-5">
        <p className="text-label uppercase text-text-muted">{t('Bill to')}</p>
        <p className="mt-1 font-bold">{inv.receiver.name}</p>
        <p className="text-caption text-text-muted">{inv.receiver.address}</p>
        {inv.receiver.taxId && (
          <p className="text-caption">
            {t('Tax registration')}: <span className="ltr-iso">{inv.receiver.taxId}</span>
          </p>
        )}
      </section>
      <table className="mt-6 w-full text-body-sm">
        <thead>
          <tr className="border-b border-line text-start text-caption uppercase text-text-muted">
            <th className="py-2 text-start">{t('Description')}</th>
            <th className="py-2 text-end">{t('Quantity')}</th>
            <th className="py-2 text-end">{t('Before VAT')}</th>
            <th className="py-2 text-end">{t('VAT {rate}%', { rate })}</th>
            <th className="py-2 text-end">{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.items.map((l, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-2">{locale === 'ar' ? l.descriptionAr : l.description}</td>
              <td className="ltr-iso py-2 text-end">{l.quantity}</td>
              <td className="py-2 text-end">{egp(l.net)}</td>
              <td className="py-2 text-end">{egp(l.vat)}</td>
              <td className="py-2 text-end font-bold">{egp(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-auto mt-4 max-w-xs space-y-1 text-body-sm">
        <div className="flex justify-between">
          <span>{t('Before VAT')}</span>
          <span>{egp(inv.net)}</span>
        </div>
        <div className="flex justify-between">
          <span>{t('VAT {rate}%', { rate })}</span>
          <span>{egp(inv.vat)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-2 text-body font-bold">
          <span>{t('Total')}</span>
          <span>{egp(inv.total)}</span>
        </div>
      </div>
      {inv.reason && (
        <p className="mt-6 text-caption text-text-muted">
          {t('Reason')}: {inv.reason}
        </p>
      )}
    </article>
  );
}
