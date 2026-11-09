'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { confirm, toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import type { Holder } from '../holders/page';
import type { Wallet } from '../wallets/page';
import { ACCOUNTING_MENU } from '../menu';

interface Payout {
  id: string;
  merchantId: string;
  companyKey: string;
  amount: number;
  status: string;
  reference: string | null;
  preparedById: string;
  createdAt: string;
}

export default function PayoutsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [pay, setPay] = useState<Record<string, { reference?: string; fromHolderId?: string }>>({});
  const load = useCallback(async () => {
    const [p, w, h] = await Promise.all([api<Payout[]>('/money/payouts'), api<{ rows: Wallet[] }>('/money/wallets'), api<Holder[]>('/money/holders')]);
    setRows(p);
    setWallets(w.rows);
    setHolders(h);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'accounting'));
    }
  };
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.companyKey) delete body.companyKey;
    void run(async () => {
      await api('/money/payouts', { method: 'POST', json: body });
      form.reset();
    });
  };
  const merchant = (id: string) => wallets.find((w) => w.merchantId === id)?.name ?? id;
  const canUse = atLeast(me.access.accounting, 'use');
  const canManage = atLeast(me.access.accounting, 'manage');
  const holderName = (h: Holder) => (locale === 'ar' ? h.nameAr : h.nameEn);
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      {canUse && (
        <form className="inline-form card" onSubmit={create}>
          <label>
            {t('accounting.merchant')}
            <select name="merchantId" aria-label={t('accounting.merchant')} required defaultValue="">
              <option value="" disabled />
              {wallets.map((w) => (
                <option key={w.merchantId} value={w.merchantId}>{`${w.name} · ${w.code}`}</option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.paidBy')}
            <select name="companyKey" aria-label={t('accounting.paidBy')} defaultValue="">
              <option value="" />
              <option value="shiply_now">{t('accounting.companies.shiply_now')}</option>
              <option value="shiply">{t('accounting.companies.shiply')}</option>
            </select>
          </label>
          <label>
            {t('accounting.amount')}
            <input name="amount" required inputMode="decimal" dir="ltr" />
          </label>
          <button className="btn primary">{t('accounting.preparePayout')}</button>
        </form>
      )}
      <ListPage<Payout>
        title={t('accounting.payouts')}
        columns={[
          { key: 'merchant', label: t('accounting.merchant'), render: (r) => merchant(r.merchantId) },
          { key: 'company', label: t('accounting.company'), render: (r) => t(`accounting.companies.${r.companyKey}`) },
          { key: 'amount', label: t('accounting.amount'), render: (r) => formatEgp(r.amount, locale) },
          { key: 'status', label: t('accounting.status'), render: (r) => <span className={`pill${r.status === 'paid' ? ' on' : ''}`}>{t(`accounting.pstatus.${r.status}`)}</span> },
          { key: 'reference', label: t('accounting.reference'), render: (r) => r.reference ?? '' },
          {
            key: 'actions',
            label: '',
            render: (r) => {
              if (r.status === 'draft')
                return (
                  <div className="row-actions">
                    {canManage && r.preparedById !== me.id && (
                      <button
                        className="btn primary"
                        onClick={() =>
                          void confirm({ title: t('accounting.approve'), body: t('accounting.approveBody') }).then(async (ok) => {
                            if (ok) await run(() => api(`/money/payouts/${r.id}/approve`, { method: 'POST' }));
                          })
                        }
                      >
                        {t('accounting.approve')}
                      </button>
                    )}
                    {canUse && (
                      <button className="btn" onClick={() => void run(() => api(`/money/payouts/${r.id}/cancel`, { method: 'POST' }))}>
                        {t('accounting.cancel')}
                      </button>
                    )}
                  </div>
                );
              if (r.status === 'approved' && canUse) {
                const v = pay[r.id] ?? {};
                const set = (patch: typeof v) => setPay({ ...pay, [r.id]: { ...v, ...patch } });
                return (
                  <div className="row-actions">
                    <input aria-label={t('accounting.reference')} value={v.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} dir="ltr" size={10} />
                    <select aria-label={t('accounting.payFrom')} value={v.fromHolderId ?? ''} onChange={(e) => set({ fromHolderId: e.target.value })}>
                      <option value="" disabled />
                      {holders.filter((h) => h.active && h.companyKey === r.companyKey).map((h) => (
                        <option key={h.id} value={h.id}>{holderName(h)}</option>
                      ))}
                    </select>
                    <button className="btn primary" onClick={() => void run(() => api(`/money/payouts/${r.id}/paid`, { method: 'POST', json: { reference: v.reference ?? '', fromHolderId: v.fromHolderId ?? '' } }))}>
                      {t('accounting.markPaid')}
                    </button>
                    <button className="btn" onClick={() => void run(() => api(`/money/payouts/${r.id}/cancel`, { method: 'POST' }))}>
                      {t('accounting.cancel')}
                    </button>
                  </div>
                );
              }
              return null;
            },
          },
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
