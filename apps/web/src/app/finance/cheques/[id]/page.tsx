import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { ChequeActions, type ChequeDetail, ChequeStatusPill } from '@/components/finance/Cheques';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One cheque: where it is on its path, what it was booked against, its entries and history. */
export default async function FinanceChequePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [cheque, doc, profile, t, locale] = await Promise.all([
    apiGet<ChequeDetail>(`/finance/cheques/${id}`),
    apiGet<DocDescriptor>(`/finance/documents/cheque/${id}`),
    getMyProfile(),
    getTranslations('finance.cheques'),
    getLocale(),
  ]);
  const canUse = canDo(profile, 'accounting', 'use');
  const banks = canUse
    ? (await apiGet<BookAccount[]>('/finance/accounts')).filter(
        (a) => a.groupCode === 1100 && a.isActive,
      )
    : [];
  const named = (a: { code: string; nameEn: string; nameAr: string } | null) =>
    a ? `${a.code} ${locale === 'ar' ? a.nameAr : a.nameEn}` : null;
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex flex-wrap justify-between gap-2 border-t border-line py-2 first:border-t-0">
        <dt className="text-text-muted">{label}</dt>
        <dd className="text-end">{value}</dd>
      </div>
    ) : null;
  const entry = (e: { id: string; number: string } | null) =>
    e ? (
      <Link href={`/finance/journal?q=${e.number}&f=`} className="ltr-iso font-bold text-link">
        {e.number}
      </Link>
    ) : null;
  return (
    <DocumentPage
      doc={doc}
      showFields={false}
      actions={canUse ? <ChequeActions cheque={cheque} banks={banks} /> : undefined}
    >
      <p>
        <ChequeStatusPill status={cheque.status} />
      </p>
      {cheque.requestId && (
        <p className="mt-3 text-body-sm">
          {t('waiting')}{' '}
          <Link href="/finance/approvals" className="font-bold text-link">
            {t('openApprovals')}
          </Link>
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <dl className="rounded-lg border border-line bg-surface p-4 text-body-sm">
          {row(t('direction'), t(`directions.${cheque.direction}`))}
          {row(t('purpose'), t(`purposes.${cheque.purpose}`))}
          {row(t('party'), cheque.partyName)}
          {row(t('bankName'), cheque.bankName)}
          {row(t('chequeNumber'), <span className="ltr-iso">{cheque.chequeNumber}</span>)}
          {row(t('amount'), <Amount piastres={cheque.amountPiastres} strong />)}
          {row(t('issueDate'), <span className="ltr-iso">{isoToDayFirst(cheque.issueDate)}</span>)}
          {row(t('dueDate'), <span className="ltr-iso">{isoToDayFirst(cheque.dueDate)}</span>)}
          {row(t('merchant'), cheque.merchant?.name)}
          {row(t('supplier'), cheque.supplier?.name)}
          {row(
            t('bill'),
            cheque.bill
              ? `BILL-${String(cheque.bill.number).padStart(6, '0')} ${cheque.bill.reference}`
              : null,
          )}
          {row(
            t('payout'),
            cheque.payout ? `PAY-${String(cheque.payout.number).padStart(6, '0')}` : null,
          )}
          {row(t('incomeAccount'), named(cheque.incomeAccount))}
          {row(t('ourBank'), named(cheque.bankAccount))}
          {row(t('note'), cheque.note)}
          {row(
            t('status'),
            cheque.bounceReason
              ? t('bounced', { reason: cheque.bounceReason })
              : cheque.cancelNote
                ? t('cancelled', { note: cheque.cancelNote })
                : null,
          )}
          {row('', t('createdBy', { name: cheque.createdBy }))}
        </dl>
        <div className="space-y-4">
          <dl className="rounded-lg border border-line bg-surface p-4 text-body-sm">
            <h2 className="mb-2 text-h3">{t('entries')}</h2>
            {row(t('booked'), entry(cheque.bookEntry))}
            {row(t('clearedEntry'), entry(cheque.clearEntry))}
            {row(t('reversed'), entry(cheque.reverseEntry))}
          </dl>
          {cheque.photoId && (
            <figure className="rounded-lg border border-line bg-surface p-4">
              <figcaption className="mb-2 text-h3">{t('photoTitle')}</figcaption>
              <a href={`/api/photos/${cheque.photoId}`} target="_blank" rel="noreferrer">
                <img
                  src={`/api/photos/${cheque.photoId}`}
                  alt={t('photoTitle')}
                  className="max-h-60 rounded-md border border-line object-contain"
                />
              </a>
            </figure>
          )}
        </div>
      </div>
    </DocumentPage>
  );
}
