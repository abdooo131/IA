'use client';
import { useTranslations } from 'next-intl';
import { useLookups } from './shared';

export type WhereNowValue =
  | { kind: 'merchant'; merchantId: string }
  | { kind: 'courier'; userId: string | null }
  | { kind: 'site'; siteId: string | null; bagSeal?: string }
  | { kind: 'car'; carId: string | null; fromSiteId: string | null; toSiteId: string | null; bagSeal?: string }
  | { kind: 'customer' }
  | { kind: 'none' };

/** Where a parcel physically is now, in words. */
export function useWhereNow() {
  const t = useTranslations('shiply');
  const look = useLookups();
  const siteName = (id: string | null) => {
    const s = look.sites.find((x) => x.id === id);
    return s ? look.label(s) : '';
  };
  return (w?: WhereNowValue): { icon: string; text: string } => {
    switch (w?.kind) {
      case 'merchant':
        return { icon: 'store', text: t('nowAt.merchant', { name: look.merchant(w.merchantId) }) };
      case 'courier':
        return { icon: 'courier', text: t('nowAt.courier', { name: look.person(w.userId) || '…' }) };
      case 'site':
        return { icon: 'inventory', text: w.bagSeal ? t('nowAt.bag', { seal: w.bagSeal, site: siteName(w.siteId) }) : t('nowAt.site', { site: siteName(w.siteId) }) };
      case 'car':
        return { icon: 'route', text: t('nowAt.car', { from: look.site(w.fromSiteId), to: look.site(w.toSiteId) }) };
      case 'customer':
        return { icon: 'delivered', text: t('nowAt.customer') };
      default:
        return { icon: 'alert', text: '' };
    }
  };
}
