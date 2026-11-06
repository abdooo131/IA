import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LogoOnColor } from './Logo';

/**
 * The frame of the public sign in and sign up pages: on wide screens a Navy brand panel with the
 * guide's city route pattern, the logo and the line "From order to growth."; the form sits on
 * the page beside it.
 */
export async function BrandPanel({ top, children }: { top: ReactNode; children: ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col overflow-hidden shiply-route border-e border-line p-10 text-shiply-cream lg:flex">
        <div className="self-start">
          <LogoOnColor alt={t('common.appName')} />
        </div>
        <div className="mt-auto max-w-sm">
          <p className="text-h1">{t('login.tagline')}</p>
          <p className="mt-4 text-body-lg opacity-90">{t('login.taglineNote')}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end px-4 py-3">{top}</div>
        {children}
      </div>
    </div>
  );
}
