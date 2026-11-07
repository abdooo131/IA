import { cookies } from 'next/headers';
import { LocaleProvider, type Locale } from '@/parcels/lib/i18n';

/**
 * The Shiply parcel network's screens (hubs, couriers, agents, merchants' parcels, network admin).
 * Shiply Now's root layout gives the page, fonts and theme; this adds the network's wording.
 * The language cookie is shared, so both apps speak the same language.
 */
export default async function ParcelsLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const locale: Locale = jar.get('shiply_locale')?.value === 'ar' ? 'ar' : 'en';
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}
