import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { LogoOnColor } from './Logo';

/**
 * The frame of the public sign in and sign up pages: on wide screens a brand panel (Navy, or
 * Shiply Blue in the dark theme) with the logo, the line "From order to growth." and the S tape
 * pattern (kept below the text, never behind it); the form sits on the page beside it.
 */
export async function BrandPanel({ top, children }: { top: ReactNode; children: ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="relative hidden w-[44%] max-w-[560px] flex-col overflow-hidden bg-hero p-10 text-hero-ink lg:flex">
        <div className="self-start">
          <LogoOnColor alt={t('common.appName')} />
        </div>
        <div className="mt-24 max-w-sm">
          <p className="text-h1">{t('login.tagline')}</p>
          <p className="mt-4 text-body-lg opacity-90">{t('login.taglineNote')}</p>
        </div>
        <div
          aria-hidden="true"
          className="shiply-tape absolute inset-x-0 bottom-0 h-64 [mask-image:linear-gradient(to_top,#000,transparent)]"
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end px-4 py-3">{top}</div>
        {children}
      </div>
    </div>
  );
}
