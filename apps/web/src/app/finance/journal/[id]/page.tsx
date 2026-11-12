import type { DocDescriptor } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import { PrintButton } from '@/components/finance/PrintButton';
import { translatorIn } from '@/i18n/fixed-locale';

export const dynamic = 'force-dynamic';

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * The printed journal voucher (A4): only shown when printing, the page itself is hidden then.
 * Our company, the voucher number and day, its type and description, the lines with their
 * totals, who prepared and approved it, and boxes to sign.
 */
async function Voucher({ doc }: { doc: DocDescriptor }) {
  const [t, tf, locale] = await Promise.all([
    getTranslations('voucher'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const field = (k: string) => doc.fields.find((f) => f.key === k)?.value ?? null;
  const kind = text(field('kind'));
  const company =
    text(
      locale === 'ar' ? doc.data.companyNameAr || doc.data.companyNameEn : doc.data.companyNameEn,
    ) || 'Shiply Now';
  const rows = doc.lines?.rows ?? [];
  const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const cell = 'border border-black/30 px-2 py-1';
  const info: [string, string][] = [
    [t('number'), doc.number],
    [t('date'), isoToDayFirst(text(field('day')).slice(0, 10))],
    [t('type'), tf.has(`kinds.${kind}`) ? tf(`kinds.${kind}`) : kind],
  ];
  if (field('memo')) info.push([t('description'), text(field('memo'))]);
  if (field('source')) info.push([t('postedFor'), text(field('source'))]);
  return (
    <section className="hidden bg-white text-[11pt] text-black print:block" aria-hidden>
      <header className="border-b-2 border-black pb-2">
        <p className="text-[15pt] font-bold">{company}</p>
        {doc.data.companyTaxNumber && (
          <p>
            {t('taxNumber')}: <span className="ltr-iso">{text(doc.data.companyTaxNumber)}</span>
          </p>
        )}
        <h1 className="mt-2 text-[14pt] font-bold">
          {t('title')} <span className="ltr-iso">{doc.number}</span>
        </h1>
      </header>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        {info.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-bold">{k}</dt>
            <dd className="whitespace-pre-wrap">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr>
            <th className={`${cell} text-start`}>{t('account')}</th>
            <th className={`${cell} text-start`}>{t('details')}</th>
            <th className={`${cell} text-end`}>{t('debit')}</th>
            <th className={`${cell} text-end`}>{t('credit')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              <td className={cell}>
                {text(locale === 'ar' && r.accountAr ? r.accountAr : r.account)}
              </td>
              <td className={cell}>
                {[r.store, r.merchant, r.rider].filter(Boolean).map(text).join(' · ')}
              </td>
              <td className={`${cell} ltr-iso text-end`}>
                {r.debit ? formatEgp(Number(r.debit)) : ''}
              </td>
              <td className={`${cell} ltr-iso text-end`}>
                {r.credit ? formatEgp(Number(r.credit)) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className={cell} colSpan={2}>
              {t('total')}
            </td>
            <td className={`${cell} ltr-iso text-end`}>{formatEgp(sum('debit'))}</td>
            <td className={`${cell} ltr-iso text-end`}>{formatEgp(sum('credit'))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-[9pt]">{t('amounts')}</p>
      <div className="mt-10 grid grid-cols-3 gap-4 break-inside-avoid">
        {[
          [t('preparedBy'), text(doc.data.madeBy)],
          [t('checkedBy'), ''],
          [t('approvedBy'), text(doc.data.approvedBy)],
        ].map(([label, name]) => (
          <div key={label} className="flex h-28 flex-col border border-black/40 p-2">
            <span className="font-bold">{label}</span>
            <span>{name}</span>
            <span className="mt-auto border-t border-black/40 pt-1 text-[9pt]">
              {t('signature')}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One journal entry: its lines (debit and credit), the document it was posted for, receipts. */
export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, t, tf] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/ledger_entry/${id}`),
    getTranslations('voucher'),
    getTranslations('finance'),
  ]);
  const kind = text(doc.fields.find((f) => f.key === 'kind')?.value);
  const kindLabel = tf.has(`kinds.${kind}`) ? tf(`kinds.${kind}`) : kind;
  // Each PDF names the type in its own language, whatever the reader's language is.
  const [kindEn, kindAr] = await Promise.all([
    translatorIn('en', 'finance'),
    translatorIn('ar', 'finance'),
  ]);
  const pdf = (lang: 'en' | 'ar') => {
    const tr = lang === 'en' ? kindEn : kindAr;
    const label = tr.has(`kinds.${kind}`) ? tr(`kinds.${kind}`) : kindLabel;
    return `/api/finance/journal/${id}/voucher.pdf?lang=${lang}&kind=${encodeURIComponent(label)}`;
  };
  const link =
    'inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold';
  return (
    <>
      <div className="print:hidden">
        <DocumentPage
          doc={doc}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PrintButton />
              <a href={pdf('en')} className={link}>
                {t('pdfEn')}
              </a>
              <a href={pdf('ar')} className={link}>
                {t('pdfAr')}
              </a>
            </div>
          }
        />
      </div>
      <Voucher doc={doc} />
    </>
  );
}
