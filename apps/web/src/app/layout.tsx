import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { directionOf, toLocale } from '@/lib/preferences';
import { getTheme } from '@/lib/server-session';
import '@/styles/globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName') };
}

export const viewport: Viewport = {
  themeColor: '#0047BB',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = toLocale(await getLocale());
  const theme = await getTheme();

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      data-theme={theme === 'system' ? undefined : theme}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
