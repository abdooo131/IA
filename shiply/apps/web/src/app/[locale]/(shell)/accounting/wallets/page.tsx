'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { formatEgp } from '@shiply/shared';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { ACCOUNTING_MENU } from '../menu';

export interface Wallet {
  merchantId: string;
  name: string;
  code: string;
  collected: number;
  fees: number;
  vat: number;
  paidOut: number;
  available: number;
}

export default function WalletsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<(Wallet & { id: string })[] | null>(null);
  useEffect(() => {
    api<{ rows: Wallet[] }>(`/money/wallets?q=${encodeURIComponent(q)}`).then((r) => setRows(r.rows.map((w) => ({ ...w, id: w.merchantId }))), () => toast.error(t('common.failed')));
  }, [q, t]);
  const m = (v: number) => formatEgp(v, locale);
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      <ListPage<Wallet & { id: string }>
        title={t('accounting.wallets')}
        filters={<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('accounting.merchant')} aria-label={t('accounting.merchant')} />}
        columns={[
          { key: 'name', label: t('accounting.merchant'), render: (r) => `${r.name} · ${r.code}` },
          { key: 'collected', label: t('accounting.collected'), render: (r) => m(r.collected) },
          { key: 'fees', label: t('accounting.fees'), render: (r) => m(r.fees) },
          { key: 'vat', label: t('accounting.vat'), render: (r) => m(r.vat) },
          { key: 'paidOut', label: t('accounting.paidOut'), render: (r) => m(r.paidOut) },
          { key: 'available', label: t('accounting.available'), render: (r) => <strong>{m(r.available)}</strong> },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
        onRowClick={(r) => router.push(`/accounting/wallets/${r.merchantId}`)}
      />
    </AppShell>
  );
}
