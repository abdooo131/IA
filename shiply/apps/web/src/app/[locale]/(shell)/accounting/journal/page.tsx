'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { CompanySwitch, useCompany } from '../company';
import { ACCOUNTING_MENU } from '../menu';

interface Entry {
  id: string;
  companyKey: string;
  date: string;
  memo: string;
  sourceType: string;
  lines: { accountCode: string; debit: number; credit: number }[];
}

export default function JournalPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const [company, setCompany] = useCompany();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Entry[]; total: number; pageSize: number } | null>(null);
  useEffect(() => {
    api<{ rows: Entry[]; total: number; pageSize: number }>(`/money/journal?company=${company}&page=${page}`).then(setData, () => toast.error(t('common.failed')));
  }, [company, page, t]);
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <div className="inline-form">
        <CompanySwitch value={company} onChange={(c) => { setCompany(c); setPage(1); }} />
      </div>
      <ListPage<Entry>
        title={t('accounting.journal')}
        columns={[
          { key: 'date', label: t('accounting.date'), render: (r) => r.date.slice(0, 10) },
          { key: 'company', label: t('accounting.company'), render: (r) => t(`accounting.companies.${r.companyKey}`) },
          { key: 'memo', label: t('accounting.memo'), render: (r) => r.memo },
          {
            key: 'lines',
            label: t('accounting.account'),
            render: (r) => r.lines.map((l, i) => <div key={i} dir="ltr">{`${l.accountCode}  ${l.debit ? `${t('accounting.debit')} ${formatEgp(l.debit, locale)}` : `${t('accounting.credit')} ${formatEgp(l.credit, locale)}`}`}</div>),
          },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={data?.pageSize ?? 50}
        onPage={setPage}
        loading={!data}
      />
    </AppShell>
  );
}
