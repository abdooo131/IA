'use client';

import { useLocale, useTranslations } from 'next-intl';

export interface CostTagOption {
  id: string;
  nameEn: string;
  nameAr: string;
}

/** The user's own cost tag (a campaign, a project) on an expense line; optional. */
export function CostTagSelect({
  tags,
  name = 'costTag',
  className,
  value,
  onChange,
  label = true,
}: {
  tags: CostTagOption[];
  name?: string;
  className: string;
  value?: string;
  onChange?: (value: string) => void;
  label?: boolean;
}) {
  const t = useTranslations('loansFx.tags');
  const locale = useLocale();
  if (tags.length === 0) return null;
  const select = (
    <select
      name={name}
      {...(value !== undefined ? { value } : { defaultValue: '' })}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      aria-label={t('field')}
      className={className}
    >
      <option value="">{t('none')}</option>
      {tags.map((tag) => (
        <option key={tag.id} value={tag.id}>
          {locale === 'ar' ? tag.nameAr : tag.nameEn}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <label className="block text-caption">
      {t('field')}
      {select}
    </label>
  );
}
