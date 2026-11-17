'use client';

import { useLocale, useTranslations } from 'next-intl';
import { localized } from '@/lib/admin-types';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

export interface ClaimCategory {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  claimable: boolean;
}

/**
 * Which expense categories employees may claim back (accounting manage switches them; the
 * claim form in My HR offers only these). Kept apart from the petty cash switch: petty cash is
 * paid from a store's box at once, a claim pays a person back after their manager approves.
 */
export function ClaimCategories({
  categories,
  canManage,
}: {
  categories: ClaimCategory[];
  canManage: boolean;
}) {
  const t = useTranslations('myPay.categories');
  const locale = useLocale();
  const action = useFinanceAction();
  return (
    <section className="mt-8 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{t('title')}</h2>
      <p className="text-caption text-text-muted">{t('intro')}</p>
      <ul className="mt-2 divide-y divide-line">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-body-sm">
            <span>
              <span className="ltr-iso me-2 text-text-muted">{c.code}</span>
              {localized(c, locale)}
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={c.claimable}
                disabled={!canManage || action.busy}
                onChange={(e) =>
                  void action.send('POST', `/finance/expense-claims/categories/${c.id}`, {
                    claimable: e.target.checked,
                  })
                }
              />
              {c.claimable ? t('on') : t('off')}
            </label>
          </li>
        ))}
      </ul>
      <ActionMessage message={action.message} />
    </section>
  );
}
