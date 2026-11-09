export interface Account {
  code: string;
  nameEn: string;
  nameAr: string;
  type: string;
}

export const accountLabel = (a: Account, locale: 'ar' | 'en') => `${a.code} ${locale === 'ar' ? a.nameAr : a.nameEn}`;
