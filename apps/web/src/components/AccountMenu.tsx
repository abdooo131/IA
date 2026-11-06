'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TicketsLink } from '@/components/tickets/TicketsLink';
import type { Theme } from '@/lib/preferences';
import { PreferencesMenu } from './PreferencesMenu';
import { SignOutButton } from './SignOutButton';

/**
 * One small Settings button that opens Help, Notifications, Tickets, language, theme and Sign out, so these
 * never take a whole row of a phone screen or push the sidebar's links out of sight.
 * `up` opens the panel above the button (sidebar footer), otherwise below it (top bar).
 */
export function AccountMenu({
  theme,
  tickets,
  up = false,
  compact = false,
}: {
  theme: Theme;
  /** Merchants have no tickets, so the link (and its count) is left out for them. */
  tickets: boolean;
  up?: boolean;
  /** Only the gear icon (the sidebar footer, next to the user's name). */
  compact?: boolean;
}) {
  const t = useTranslations('common');
  const ts = useTranslations('sop');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Team members and riders see their own photo on the button (My HR); none: the gear alone.
  const [photo, setPhoto] = useState(tickets);
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

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={compact ? t('settings') : undefined}
        title={compact ? t('settings') : undefined}
        className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-body-sm font-bold"
      >
        {photo && (
          <img
            src="/api/me/employee/photo"
            alt=""
            aria-hidden="true"
            onError={() => setPhoto(false)}
            className="h-7 w-7 rounded-full border border-line object-cover"
          />
        )}
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
        {!compact && t('settings')}
      </button>
      {open && (
        <div
          className={`absolute end-0 z-50 w-64 space-y-3 rounded-lg border border-line bg-surface p-4 shadow-lg ${
            up ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <div className="flex flex-wrap gap-2">
            <Link
              href="/help"
              className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-link"
            >
              {ts('menu')}
            </Link>
            <Link
              href="/notifications"
              className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-link"
            >
              {t('notifications')}
            </Link>
            {tickets && <TicketsLink />}
            {tickets && (
              <Link
                href="/my-file"
                className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-link"
              >
                {t('myFile')}
              </Link>
            )}
          </div>
          <PreferencesMenu theme={theme} />
          <SignOutButton />
        </div>
      )}
    </div>
  );
}
