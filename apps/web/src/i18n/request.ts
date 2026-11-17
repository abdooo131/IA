import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, toLocale } from '@/lib/preferences';

// Locale comes from a cookie rather than the URL so the areas keep the plain
// paths /admin, /store and /rider.
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
