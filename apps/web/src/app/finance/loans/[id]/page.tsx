import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LoanDetail, type LoanDetailData } from '@/components/finance/LoansFx';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One loan: its schedule, the instalments paid with their entries, and Pay next. */
export default async function FinanceLoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [loan, profile, t, ta] = await Promise.all([
    apiGet<LoanDetailData>(`/finance/loans/${id}`),
    getMyProfile(),
    getTranslations('loansFx.loans'),
    getTranslations('apps'),
  ]);
  const canUse = canDo(profile, 'accounting', 'use');
  const money = canUse
    ? (await apiGet<BookAccount[]>('/finance/accounts')).filter(
        (a) => a.money && a.isActive && (a.currency ?? 'EGP') === 'EGP',
      )
    : [];
  return (
    <>
      <nav className="text-body-sm">
        <Link href="/finance" className="text-link hover:underline">
          {ta('names.accounting')}
        </Link>
        <span className="mx-1 text-text-muted">/</span>
        <Link href="/finance/loans" className="text-link hover:underline">
          {t('title')}
        </Link>
      </nav>
      <h1 className="mt-2 text-h2">
        <span className="ltr-iso">{loan.number}</span> · {loan.lenderName}
      </h1>
      <p className="mt-1 text-body-sm text-text-muted">
        {loan.status === 'repaid' ? t('repaid') : t('active')} · {loan.reference}
        {loan.memo ? ` · ${loan.memo}` : ''}
      </p>
      <LoanDetail loan={canUse ? loan : { ...loan, nextSeq: null }} money={money} />
    </>
  );
}
