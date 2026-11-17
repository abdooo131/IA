import type { ReactNode } from 'react';
import { ClientMessages } from '@/components/ClientMessages';

/** Sends this part's client components only the translations they use (src/i18n/client-messages.ts). */
export default function Layout({ children }: { children: ReactNode }) {
  return <ClientMessages scope="site">{children}</ClientMessages>;
}
