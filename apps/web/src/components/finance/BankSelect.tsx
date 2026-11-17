'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiGetClient } from '@/lib/api-client';
import type { BookAccount } from '@/lib/finance-types';

let cached: Promise<BookAccount[]> | null = null;
/** Banks and cash boxes, fetched once per page. */
export function loadMoneyAccounts() {
  cached ??= apiGetClient<BookAccount[]>('/finance/money-accounts').then((r) =>
    r.ok ? r.data : [],
  );
  return cached;
}

export function accountLabel(a: BookAccount, locale: string) {
  const name = locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn;
  return `${a.code} · ${name}`;
}

/** Which bank: empty means the main bank (CIB, 1101). */
export function BankSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  className: string;
}) {
  const t = useTranslations('finance');
  const locale = useLocale();
  const [banks, setBanks] = useState<BookAccount[]>([]);
  useEffect(() => {
    void loadMoneyAccounts().then((all) => setBanks(all.filter((a) => a.groupCode === 1100)));
  }, []);
  if (banks.length <= 1) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      aria-label={t('bank')}
    >
      <option value="">{t('mainBank')}</option>
      {banks
        .filter((b) => b.code !== '1101')
        .map((b) => (
          <option key={b.id} value={b.id}>
            {accountLabel(b, locale)}
          </option>
        ))}
    </select>
  );
}
