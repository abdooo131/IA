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
import { CompanySwitch, useCompany } from '../company';
import { ACCOUNTING_MENU } from '../menu';

export interface Holder {
  id: string;
  kind: string;
  nameEn: string;
  nameAr: string;
  companyKey: string;
  held: number;
  active: boolean;
}

export default function HoldersPage() {
  const t = useTranslations();
  const locale = useLocale() as 'ar' | 'en';
  const me = useMe();
  const [company, setCompany] = useCompany();
  const [rows, setRows] = useState<Holder[] | null>(null);
  const load = useCallback(() => api<Holder[]>(`/money/holders?company=${company}`).then(setRows, () => toast.error(t('common.failed'))), [company, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await api('/money/holders', { method: 'POST', json: Object.fromEntries(new FormData(form)) });
      form.reset();
      await load();
    } catch (err) {
      toast.error(errorText(t, err, 'accounting'));
    }
  };
  return (
    <AppShell app="accounting" menu={ACCOUNTING_MENU}>
      {atLeast(me.access.accounting, 'manage') && (
        <form className="inline-form card" onSubmit={add}>
          <label>
            {t('accounting.kind')}
            <select name="kind" aria-label={t('accounting.kind')}>
              {['rider', 'courier', 'store_box', 'hub_safe', 'agent', 'bank'].map((k) => (
                <option key={k} value={k}>
                  {t(`accounting.kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('accounting.name')}
            <input name="nameEn" required />
          </label>
          <label>
            {t('accounting.nameAr')}
            <input name="nameAr" required dir="rtl" />
          </label>
          <label>
            {t('accounting.holderCompany')}
            <select name="companyKey" aria-label={t('accounting.holderCompany')}>
              <option value="shiply_now">{t('accounting.companies.shiply_now')}</option>
              <option value="shiply">{t('accounting.companies.shiply')}</option>
            </select>
          </label>
          <button className="btn primary">{t('accounting.addHolder')}</button>
        </form>
      )}
      <ListPage<Holder>
        title={t('accounting.holders')}
        filters={<CompanySwitch value={company} onChange={setCompany} />}
        columns={[
          { key: 'name', label: t('accounting.name'), render: (r) => (locale === 'ar' ? r.nameAr : r.nameEn) },
          { key: 'kind', label: t('accounting.kind'), render: (r) => t(`accounting.kinds.${r.kind}`) },
          { key: 'company', label: t('accounting.company'), render: (r) => t(`accounting.companies.${r.companyKey}`) },
          { key: 'held', label: t('accounting.held'), render: (r) => formatEgp(r.held, locale) },
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
