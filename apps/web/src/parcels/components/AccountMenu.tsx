'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/parcels/lib/api';
import { useT } from '@/parcels/lib/i18n';
import { PreferencesMenu } from './PreferencesMenu';
import { useMe, useRoleText } from './Shell';

/**
 * One small Settings button (the gear) that opens who is signed in, language, theme and Sign
 * out, as in Shiply Now, so these never take a row of a phone screen or push menu links down.
 * `up` opens the panel above the button (side menu footer), otherwise below it (top bars).
 */
export function AccountMenu({ up = false, compact = false }: { up?: boolean; compact?: boolean }) {
  const t = useT();
  const me = useMe();
  const role = useRoleText();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    router.replace('/login');
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={compact ? t('Settings') : undefined}
        title={compact ? t('Settings') : undefined}
        className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-text"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        {!compact && t('Settings')}
      </button>
      {open && (
        <div className={`absolute end-0 z-50 w-64 space-y-3 rounded-lg border border-line bg-surface p-4 text-text shadow-lg ${up ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          <div className="min-w-0">
            <p className="truncate text-body-sm font-bold">{me.name}</p>
            <p className="truncate text-caption text-text-muted">{role}</p>
          </div>
          <PreferencesMenu />
          <button type="button" onClick={() => void signOut()} className="btn-secondary w-full">{t('Sign out')}</button>
        </div>
      )}
    </div>
  );
}
