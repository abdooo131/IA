import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { LocaleProvider, type Locale } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = { title: 'Shiply Core', description: 'Next day parcel delivery' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#082341' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const locale: Locale = jar.get('shiply_locale')?.value === 'ar' ? 'ar' : 'en';
  const theme = jar.get('shiply_theme')?.value;
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-theme={theme === 'dark' || theme === 'light' ? theme : undefined}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
