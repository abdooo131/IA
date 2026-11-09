'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { atLeast, formatEgp } from '@shiply/shared';
import { api } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { AppShell } from '@/shell/AppShell';
import { ListPage } from '@/shell/ListPage';
import { toast } from '@/shell/feedback';
import { useMe } from '@/shell/me';
import { accountLabel, type Account } from '../accounts';
import type { Holder } from '../holders/page';
import { ACCOUNTING_MENU } from '../menu';

interface Expense {
  id: string;
  companyKey: string;
  date: string;
  accountCode: string;
  amount: number;
  vat: number;
  paidFromHolderId: string;
  note: string;
}

export default function ExpensesPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [companyKey, setCompanyKey] = useState('shiply_now');
  const load = useCallback(async () => {
    const [x, a, h] = await Promise.all([api<Expense[]>('/money/expenses'), api<Account[]>('/money/accounts'), api<Holder[]>('/money/holders')]);
    setRows(x);
    setAccounts(a);
    setHolders(h);
  }, []);
  useEffect(() => {
    load().catch(() => toast.error(t('common.failed')));
  }, [load, t]);
  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api('/money/expenses', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
      toast.success(t('common.saved'));
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'accounting'));
    }
  };
  const account = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? accountLabel(a, locale) : code;
  };
  const holder = (id: string) => {
    const h = holders.find((x) => x.id === id);
    return h ? (locale === 'ar' ? h.nameAr : h.nameEn) : id;
  };
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      {atLeast(me.access.accounting, 'use') && (
        <form className="inline-form card" onSubmit={(e) => void create(e)}>
          <label>
            {t('accounting.paidBy')}
            <select name="companyKey" aria-label={t('accounting.paidBy')} value={companyKey} onChange={(e) => setCompanyKey(e.target.value)}>
              <option value="shiply_now">{t('accounting.companies.shiply_now')}</option>
              <option value="shiply">{t('accounting.companies.shiply')}</option>
            </select>
          </label>
          <label>
            {t('accounting.date')}
            <input name="date" type="date" required />
          </label>
          <label>
            {t('accounting.account')}
            <select name="accountCode" aria-label={t('accounting.account')} required defaultValue="">
              <option value="" disabled />
              {accounts.filter((a) => a.type === 'expense').map((a) => (
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
          <label>
            {t('accounting.payFrom')}
            <select name="fromHolderId" aria-label={t('accounting.payFrom')} required defaultValue="">
              <option value="" disabled />
              {holders.filter((h) => h.active && h.companyKey === companyKey).map((h) => (
                <option key={h.id} value={h.id}>{locale === 'ar' ? h.nameAr : h.nameEn}</option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.note')}
            <input name="note" required />
          </label>
          <button className="btn primary">{t('accounting.addExpense')}</button>
        </form>
      )}
      <ListPage<Expense>
        title={t('accounting.expenses')}
        columns={[
          { key: 'date', label: t('accounting.date'), render: (r) => r.date.slice(0, 10) },
          { key: 'company', label: t('accounting.company'), render: (r) => t(`accounting.companies.${r.companyKey}`) },
          { key: 'account', label: t('accounting.account'), render: (r) => account(r.accountCode) },
          { key: 'amount', label: t('accounting.amount'), render: (r) => formatEgp(r.amount + r.vat, locale) },
          { key: 'from', label: t('accounting.payFrom'), render: (r) => holder(r.paidFromHolderId) },
          { key: 'note', label: t('accounting.note'), render: (r) => r.note },
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
