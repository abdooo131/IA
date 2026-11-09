'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export type Company = '' | 'shiply_now' | 'shiply';

/** The company switch on every money page: Shiply Now | Shiply | Both. Remembered per browser. */
export function useCompany(): [Company, (c: Company) => void] {
  const [c, setC] = useState<Company>('');
  useEffect(() => {
    try {
      setC((localStorage.getItem('shiply.company') as Company) ?? '');
    } catch {
      /* private mode: start with both */
    }
  }, []);
  const set = (v: Company) => {
    setC(v);
    try {
      localStorage.setItem('shiply.company', v);
    } catch {
      /* not remembered */
    }
  };
  return [c, set];
}

export function CompanySwitch({ value, onChange }: { value: Company; onChange: (c: Company) => void }) {
  const t = useTranslations('accounting');
  return (
    <select aria-label={t('company')} value={value} onChange={(e) => onChange(e.target.value as Company)}>
      <option value="">{t('both')}</option>
      <option value="shiply_now">{t('companies.shiply_now')}</option>
      <option value="shiply">{t('companies.shiply')}</option>
    </select>
  );
}
