'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatEgp } from '@shiply/shared';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { LoadError } from '@/shell/LoadError';
import { ACCOUNTING_MENU } from '../../menu';

interface Statement {
  balance: number;
  lines: { date: string; memo: string; amount: number; running: number }[];
}

export default function StatementPage() {
  const t = useTranslations('accounting');
  const locale = useLocale() as 'ar' | 'en';
  const { merchantId } = useParams<{ merchantId: string }>();
  const [s, setS] = useState<Statement | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<Statement>(`/money/wallets/${merchantId}/statement`).then(setS, setError);
  }, [merchantId]);
  if (error) return <AppShell app="accounting" menu={ACCOUNTING_MENU}><LoadError error={error} /></AppShell>;
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <Link href="/accounting/wallets">‹ {t('wallets')}</Link>
      <div className="record-head">
        <h1>{t('statement')}</h1>
        {s && <span className="pill on">{t('balance')}: {formatEgp(s.balance, locale)}</span>}
        <div className="record-actions">
          <a className="btn ghost" href={`/api/money/wallets/${merchantId}/statement.csv`}>
            {t('downloadCsv')}
          </a>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('date')}</th>
              <th>{t('description')}</th>
              <th>{t('amount')}</th>
              <th>{t('balance')}</th>
            </tr>
          </thead>
          <tbody>
            {s?.lines.map((l, i) => (
              <tr key={i}>
                <td>{new Date(l.date).toLocaleDateString()}</td>
                <td>{l.memo}</td>
                <td dir="ltr">{formatEgp(l.amount, locale)}</td>
                <td dir="ltr">{formatEgp(l.running, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
