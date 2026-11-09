'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { MERCHANTS_MENU } from '../menu';

interface Shop {
  id: string;
  domain: string;
  status: string;
  connectedAt: string;
  merchant: { name: string; code: string };
}

export default function ShopifyPage() {
  const t = useTranslations();
  const [rows, setRows] = useState<Shop[] | null>(null);
  useEffect(() => {
    api<Shop[]>('/merchants/shops').then(setRows, () => toast.error(t('common.failed')));
  }, [t]);
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <ListPage<Shop>
        title={t('merchants.shopify')}
        columns={[
          { key: 'domain', label: t('merchants.domain'), render: (r) => <span dir="ltr">{r.domain}</span> },
          { key: 'merchant', label: t('merchants.merchant'), render: (r) => `${r.merchant.name} · ${r.merchant.code}` },
          { key: 'connectedAt', label: t('merchants.connectedAt'), render: (r) => new Date(r.connectedAt).toLocaleDateString() },
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
