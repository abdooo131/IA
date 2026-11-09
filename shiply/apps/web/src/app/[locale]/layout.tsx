import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { FeedbackHost } from '@/shell/feedback';
import '@/theme/tokens.css';
import '@/theme/globals.css';
import '@/theme/ui.css';

export const metadata = { title: 'Shiply', icons: { icon: '/brand/app-icon.svg', apple: '/brand/app-icon-180.png' } };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as 'en' | 'ar')) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <FeedbackHost />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
