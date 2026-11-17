import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { CLIENT_SCOPES, type ClientScope, pickMessages } from '@/i18n/client-messages';

/**
 * The translations provider of one part of the site: its client components get only the
 * namespaces their scope names (src/i18n/client-messages.ts), never the whole file.
 */
export async function ClientMessages({
  scope,
  children,
}: {
  scope: ClientScope;
  children: ReactNode;
}) {
  const messages = (await getMessages()) as Record<string, unknown>;
  return (
    <NextIntlClientProvider messages={pickMessages(messages, CLIENT_SCOPES[scope]) as never}>
      {children}
    </NextIntlClientProvider>
  );
}
