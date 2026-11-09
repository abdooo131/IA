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

interface Row {
  accountCode: string;
  nameEn: string;
  nameAr: string;
  debit: number;
  credit: number;
}

export default function TrialBalancePage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const [company, setCompany] = useCompany();
  const [rows, setRows] = useState<(Row & { id: string })[] | null>(null);
  useEffect(() => {
    api<Row[]>(`/money/trial-balance?company=${company}`).then((r) => setRows(r.map((x) => ({ ...x, id: x.accountCode }))), () => toast.error(t('common.failed')));
  }, [company, t]);
  const sum = (k: 'debit' | 'credit') => (rows ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <div className="inline-form">
        <CompanySwitch value={company} onChange={setCompany} />
        <span>
          {t('accounting.debit')} {formatEgp(sum('debit'), locale)} · {t('accounting.credit')} {formatEgp(sum('credit'), locale)}
        </span>
      </div>
      <ListPage<Row & { id: string }>
        title={t('accounting.trial')}
        columns={[
          { key: 'code', label: t('accounting.account'), render: (r) => r.accountCode },
          { key: 'name', label: t('accounting.name'), render: (r) => (locale === 'ar' ? r.nameAr : r.nameEn) },
          { key: 'debit', label: t('accounting.debit'), render: (r) => formatEgp(r.debit, locale) },
          { key: 'credit', label: t('accounting.credit'), render: (r) => formatEgp(r.credit, locale) },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
      />
    </AppShell>
  );
}
