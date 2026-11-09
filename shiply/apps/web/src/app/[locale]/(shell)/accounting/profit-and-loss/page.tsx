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

interface Line {
  accountCode: string;
  nameEn: string;
  nameAr: string;
  type: string;
  amount: number;
}
interface Pnl {
  income: number;
  expense: number;
  net: number;
  lines: Line[];
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

export default function ProfitAndLossPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const [company, setCompany] = useCompany();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [pnl, setPnl] = useState<Pnl | null>(null);
  useEffect(() => {
    api<Pnl>(`/money/profit-and-loss?company=${company}&from=${from}&to=${to}`).then(setPnl, () => toast.error(t('common.failed')));
  }, [company, from, to, t]);
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <div className="inline-form card">
        <CompanySwitch value={company} onChange={setCompany} />
        <label>
          {t('accounting.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('accounting.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {pnl && (
        <div className="inline-form card">
          <span>
            {t('accounting.income')}: <strong data-testid="pnl-income">{formatEgp(pnl.income, locale)}</strong>
          </span>
          <span>
            {t('accounting.expense')}: <strong>{formatEgp(pnl.expense, locale)}</strong>
          </span>
          <span>
            {t('accounting.net')}: <strong data-testid="pnl-net">{formatEgp(pnl.net, locale)}</strong>
          </span>
        </div>
      )}
      <ListPage<Line & { id: string }>
        title={t('accounting.pnl')}
        columns={[
          { key: 'code', label: t('accounting.account'), render: (r) => r.accountCode },
          { key: 'name', label: t('accounting.name'), render: (r) => (locale === 'ar' ? r.nameAr : r.nameEn) },
          { key: 'type', label: t('accounting.kind'), render: (r) => (r.type === 'income' ? t('accounting.income') : t('accounting.expense')) },
          { key: 'amount', label: t('accounting.amount'), render: (r) => formatEgp(r.amount, locale) },
        ]}
        rows={(pnl?.lines ?? []).map((l) => ({ ...l, id: l.accountCode }))}
        total={pnl?.lines.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!pnl}
      />
    </AppShell>
  );
}
