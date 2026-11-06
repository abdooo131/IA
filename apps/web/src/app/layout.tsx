import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { directionOf, toLocale } from '@/lib/preferences';
import { PushRegistrar } from '@/components/PushRegistrar';
import { getClaims, getTheme } from '@/lib/server-session';
import '@/styles/globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: t('appName'),
    // Installed on a phone's home screen it opens full screen with the Shiply icon.
    appleWebApp: { capable: true, title: t('appName'), statusBarStyle: 'default' },
    icons: { icon: '/brand/app-icon-192.png', apple: '/brand/app-icon-180.png' },
  };
}

export const viewport: Viewport = {
  // The browser bar takes the page ground: Cream, or Navy in the dark theme.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F6FA' },
    { media: '(prefers-color-scheme: dark)', color: '#082341' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = toLocale(await getLocale());
  const theme = await getTheme();
  // The service worker only runs in production builds and once the server has push keys.
  const push = process.env.NODE_ENV === 'production' && Boolean(process.env.VAPID_PUBLIC_KEY);
  const signedIn = push && (await getClaims()) !== null;

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      data-theme={theme === 'system' ? undefined : theme}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          {children}
          {push && <PushRegistrar signedIn={signedIn} />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
