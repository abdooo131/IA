'use client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { atLeast } from '@shiply/shared';
import { useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import type { MerchantRow } from '../list/page';
import { MERCHANTS_MENU } from '../menu';

export default function SignupsPage() {
  const t = useTranslations();
  const me = useMe();
  const router = useRouter();
  const [rows, setRows] = useState<MerchantRow[] | null>(null);
  const load = useCallback(() => api<{ rows: MerchantRow[] }>('/merchants/signups').then((r) => setRows(r.rows), () => toast.error(t('common.failed'))), [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const canManage = atLeast(me.access.merchants, 'manage');
  const decide = async (r: MerchantRow, approve: boolean) => {
    let body: object | undefined;
    if (approve) {
      if (!(await confirm({ title: t('merchants.approve'), body: t('merchants.approveBody') }))) return;
    } else {
      const reason = window.prompt(t('merchants.rejectReason'));
      if (!reason) return;
      body = { reason };
    }
    try {
      await api(`/merchants/${r.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', json: body ?? {} });
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'merchants'));
    }
  };
  return (
    <AppShell app="merchants" menu={MERCHANTS_MENU}>
      <ListPage<MerchantRow>
        title={t('merchants.signups')}
        columns={[
          { key: 'name', label: t('merchants.name') },
          { key: 'contact', label: t('merchants.contactName'), render: (r) => <span>{r.contactName} <span dir="ltr" className="muted">{r.contactPhone}</span></span> },
          { key: 'createdAt', label: t('merchants.submitted'), render: (r) => new Date(r.createdAt).toLocaleString() },
          {
            key: 'actions',
            label: '',
            render: (r) =>
              canManage ? (
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn primary" onClick={() => void decide(r, true)}>
                    {t('merchants.approve')}
                  </button>
                  <button className="btn ghost" onClick={() => void decide(r, false)}>
                    {t('merchants.reject')}
                  </button>
                </div>
              ) : null,
          },
        ]}
        rows={rows ?? []}
        total={rows?.length ?? 0}
        page={1}
        pageSize={500}
        onPage={() => undefined}
        loading={!rows}
        onRowClick={(r) => router.push(`/merchants/${r.id}`)}
      />
    </AppShell>
  );
}
