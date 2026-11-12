'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import type { SiteNavItem } from './site-nav';

/**
 * The phone menu: a button that opens the page links, Sign in and Start selling below the top
 * bar. It closes on Escape, on a tap outside and when another page opens.
 */
export function SiteMenu({ items }: { items: SiteNavItem[] }) {
  const t = useTranslations('site.nav');
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className="s-menu" ref={root}>
      <button
        type="button"
        className="s-menu-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? t('closeMenu') : t('menu')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id={panelId} className="s-menu-panel" hidden={!open} aria-label={t('mainLabel')}>
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.current ? 'page' : undefined}
            className={item.current ? 's-on' : undefined}
            onClick={() => setOpen(false)}
          >
            {t(item.key)}
          </Link>
        ))}
        <Link href="/login" className="s-menu-signin">
          {t('signIn')}
        </Link>
        <Link href="/contact" className="s-btn s-btn-primary" onClick={() => setOpen(false)}>
          {t('cta')}
        </Link>
      </nav>
    </div>
  );
}
