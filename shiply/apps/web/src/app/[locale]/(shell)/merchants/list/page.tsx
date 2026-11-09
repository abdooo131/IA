'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { MERCHANTS_MENU } from '../menu';

export interface MerchantRow {
  id: string;
  code: string;
  name: string;
  contactName: string;
  contactPhone: string;
  services: string[];
  status: string;
  createdAt: string;
}

export default function MerchantsList() {
  const t = useTranslations();
  const me = useMe();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: MerchantRow[]; total: number } | null>(null);
  useEffect(() => {
    api<{ rows: MerchantRow[]; total: number }>(`/merchants?page=${page}&q=${encodeURIComponent(q)}&status=${status}`).then(setData, () => toast.error(t('common.failed')));
  }, [page, q, status, t]);
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <ListPage<MerchantRow>
        title={t('merchants.merchants')}
        action={
          atLeast(me.access.merchants, 'use') ? (
            <Link href="/merchants/new" className="btn primary">
              {t('merchants.newMerchant')}
            </Link>
          ) : undefined
        }
        filters={
          <>
            <input type="search" value={q} onChange={(e) => (setPage(1), setQ(e.target.value))} placeholder={t('merchants.search')} aria-label={t('merchants.search')} />
            <select aria-label={t('merchants.status')} value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))}>
              <option value="">{t('merchants.status')}</option>
              {['approved', 'pending', 'rejected', 'inactive'].map((s) => (
                <option key={s} value={s}>
                  {t(`merchants.statuses.${s}`)}
                </option>
              ))}
            </select>
          </>
        }
        columns={[
          { key: 'name', label: t('merchants.name'), render: (r) => `${r.name}` },
          { key: 'code', label: t('merchants.code') },
          { key: 'services', label: t('merchants.services'), render: (r) => r.services.map((s) => t(`apps.${s}`)).join(' + ') },
          { key: 'contact', label: t('merchants.contactName'), render: (r) => <span>{r.contactName} <span dir="ltr" className="muted">{r.contactPhone}</span></span> },
          { key: 'status', label: t('merchants.status'), render: (r) => <span className={`pill${r.status === 'approved' ? ' on' : ''}`}>{t(`merchants.statuses.${r.status}`)}</span> },
        ]}
        rows={data?.rows ?? []}
        total={data?.total ?? 0}
        page={page}
        onPage={setPage}
        loading={!data}
        onRowClick={(r) => router.push(`/merchants/${r.id}`)}
      />
    </AppShell>
  );
}
