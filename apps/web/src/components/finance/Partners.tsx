'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MerchantTax, PartnerRow, SupplierRow } from '@/lib/finance-types';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

/** Every partner with their net: positive owes us, negative we owe them. */
export function PartnerList({
  partners,
  suppliers,
  merchants,
}: {
  partners: PartnerRow[];
  suppliers: SupplierRow[];
  merchants: MerchantTax[];
}) {
  const t = useTranslations('finance.partners');
  const [filter, setFilter] = useState('');
  const shown = partners.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="mt-4 space-y-6">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        className="h-10 w-full max-w-sm rounded-md border border-line bg-surface px-2 text-body-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('name')}</th>
              <th className={th}>{t('kind')}</th>
              <th className={`${th} text-end`}>{t('accounts')}</th>
              <th className={`${th} text-end`}>{t('net')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={`${p.kind}:${p.id}`} className="border-t border-line">
                <td className={td}>
                  <a href={`/finance/partners/${p.kind}/${p.id}`} className="font-bold underline">
                    {p.name}
                  </a>
                </td>
                <td className={td}>
                  {t.has(`kinds.${p.detail}`) ? t(`kinds.${p.detail}`) : p.detail}
                </td>
                <td className={`${td} text-end`}>{p.accounts}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.netPiastres} strong />
                  <span className="block text-caption text-text-muted">
                    {p.netPiastres > 0 ? t('owesUs') : p.netPiastres < 0 ? t('weOwe') : t('even')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="space-y-2">
        <h2 className="text-h3">{t('linkTitle')}</h2>
        <p className="text-caption text-text-muted">{t('linkHint')}</p>
        {suppliers.map((s) => (
          <SupplierLink key={s.id} supplier={s} merchants={merchants} />
        ))}
      </section>
    </div>
  );
}

function SupplierLink({
  supplier,
  merchants,
}: {
  supplier: SupplierRow;
  merchants: MerchantTax[];
}) {
  const t = useTranslations('finance.partners');
  const action = useFinanceAction();
  const [value, setValue] = useState(supplier.merchantId ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2 text-body-sm">
      <span className="min-w-40 font-bold">{supplier.name}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t('sameAs')}
        className="h-10 rounded-md border border-line bg-surface px-2"
      >
        <option value="">{t('notAMerchant')}</option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {t('sameAsMerchant', { name: m.name })}
          </option>
        ))}
      </select>
      {value !== (supplier.merchantId ?? '') && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() =>
            void action.send('PUT', `/finance/suppliers/${supplier.id}/merchant`, {
              merchantId: value || null,
            })
          }
          className="h-10 rounded-md border border-line px-3 font-bold"
        >
          {t('save')}
        </button>
      )}
      <ActionMessage message={action.message} />
    </div>
  );
}
