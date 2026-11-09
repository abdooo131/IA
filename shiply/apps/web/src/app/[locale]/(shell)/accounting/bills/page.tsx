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
import { accountLabel, type Account } from '../accounts';
import type { Holder } from '../holders/page';
import { ACCOUNTING_MENU } from '../menu';

interface Bill {
  id: string;
  companyKey: string;
  payee: string;
  number: string;
  dueDate: string;
  amount: number;
  vat: number;
  accountCode: string;
  status: string;
  preparedById: string;
}

export default function BillsPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [rows, setRows] = useState<Bill[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [from, setFrom] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const [b, a, h] = await Promise.all([api<Bill[]>('/money/bills'), api<Account[]>('/money/accounts'), api<Holder[]>('/money/holders')]);
    setRows(b);
    setAccounts(a.filter((x) => x.type === 'expense'));
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
    void run(async () => {
      await api('/money/bills', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
    });
  };
  const canUse = atLeast(me.access.accounting, 'use');
  const canManage = atLeast(me.access.accounting, 'manage');
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      {canUse && (
        <form className="inline-form card" onSubmit={create}>
          <label>
            {t('accounting.paidBy')}
            <select name="companyKey" aria-label={t('accounting.paidBy')} required defaultValue="shiply_now">
              <option value="shiply_now">{t('accounting.companies.shiply_now')}</option>
              <option value="shiply">{t('accounting.companies.shiply')}</option>
            </select>
          </label>
          <label>
            {t('accounting.payee')}
            <input name="payee" required />
          </label>
          <label>
            {t('accounting.number')}
            <input name="number" required dir="ltr" />
          </label>
          <label>
            {t('accounting.date')}
            <input name="date" type="date" required />
          </label>
          <label>
            {t('accounting.dueDate')}
            <input name="dueDate" type="date" required />
          </label>
          <label>
            {t('accounting.account')}
            <select name="accountCode" aria-label={t('accounting.account')} required defaultValue="">
              <option value="" disabled />
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>{accountLabel(a, locale)}</option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.amount')}
            <input name="amount" required inputMode="decimal" dir="ltr" />
          </label>
          <label>
            {t('accounting.vat')}
            <input name="vat" inputMode="decimal" dir="ltr" defaultValue="0" />
          </label>
          <button className="btn primary">{t('accounting.addBill')}</button>
        </form>
      )}
      <ListPage<Bill>
        title={t('accounting.bills')}
        columns={[
          { key: 'payee', label: t('accounting.payee'), render: (r) => r.payee },
          { key: 'number', label: t('accounting.number'), render: (r) => r.number },
          { key: 'company', label: t('accounting.company'), render: (r) => t(`accounting.companies.${r.companyKey}`) },
          { key: 'due', label: t('accounting.dueDate'), render: (r) => r.dueDate.slice(0, 10) },
          { key: 'amount', label: t('accounting.amount'), render: (r) => formatEgp(r.amount + r.vat, locale) },
          { key: 'status', label: t('accounting.status'), render: (r) => <span className={`pill${r.status === 'paid' ? ' on' : ''}`}>{t(`accounting.pstatus.${r.status}`)}</span> },
          {
            key: 'actions',
            label: '',
            render: (r) => {
              if (r.status === 'draft' && canManage && r.preparedById !== me.id)
                return (
                  <button
                    className="btn primary"
                    onClick={() =>
                      void confirm({ title: t('accounting.approve'), body: t('accounting.approveBody') }).then(async (ok) => {
                        if (ok) await run(() => api(`/money/bills/${r.id}/approve`, { method: 'POST' }));
                      })
                    }
                  >
                    {t('accounting.approve')}
                  </button>
                );
              if (r.status === 'approved' && canUse)
                return (
                  <div className="row-actions">
                    <select aria-label={t('accounting.payFrom')} value={from[r.id] ?? ''} onChange={(e) => setFrom({ ...from, [r.id]: e.target.value })}>
                      <option value="" disabled />
                      {holders.filter((h) => h.active && h.companyKey === r.companyKey).map((h) => (
                        <option key={h.id} value={h.id}>{locale === 'ar' ? h.nameAr : h.nameEn}</option>
                      ))}
                    </select>
                    <button className="btn primary" onClick={() => void run(() => api(`/money/bills/${r.id}/pay`, { method: 'POST', json: { fromHolderId: from[r.id] ?? '' } }))}>
                      {t('accounting.pay')}
                    </button>
                  </div>
                );
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
