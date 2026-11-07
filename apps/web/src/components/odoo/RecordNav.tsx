'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DOC_NAV_KEY, docNeighbours, readDocNav } from '@/lib/list-view';

/**
 * Previous and next record within the list the person came from (its rows are kept in the
 * tab's session storage when a row is opened), with "3 / 25" like Odoo.
 */
export function RecordNav({ id }: { id: string }) {
  const t = useTranslations('documents');
  const [nav, setNav] = useState<ReturnType<typeof docNeighbours>>(null);
  useEffect(() => {
    let text: string | null = null;
    try {
      text = window.sessionStorage.getItem(DOC_NAV_KEY);
    } catch {
      /* storage may be off */
    }
    setNav(docNeighbours(readDocNav(text), id));
  }, [id]);
  if (!nav) return null;
  const arrow =
    'flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-body font-bold hover:bg-surface-raised';
  return (
    <nav aria-label={t('recordNav')} className="flex items-center gap-1">
      <span className="ltr-iso me-1 text-caption text-text-muted">
        {nav.index} / {nav.count}
      </span>
      {nav.prev ? (
        <Link href={nav.prev} className={arrow} aria-label={t('previous')}>
          <span aria-hidden className="rtl:rotate-180">
            ‹
          </span>
        </Link>
      ) : (
        <span className={`${arrow} opacity-40`} aria-hidden>
          ‹
        </span>
      )}
      {nav.next ? (
        <Link href={nav.next} className={arrow} aria-label={t('next')}>
          <span aria-hidden className="rtl:rotate-180">
            ›
          </span>
        </Link>
      ) : (
        <span className={`${arrow} opacity-40`} aria-hidden>
          ›
        </span>
      )}
    </nav>
  );
}

/** The breadcrumb back to the list keeps the filters the person had. */
export function ListCrumb({ href, label }: { href: string; label: string }) {
  const [to, setTo] = useState(href);
  useEffect(() => {
    try {
      const nav = readDocNav(window.sessionStorage.getItem(DOC_NAV_KEY));
      if (nav?.listUrl.split('?')[0] === href) setTo(nav.listUrl);
    } catch {
      /* storage may be off */
    }
  }, [href]);
  return (
    <Link href={to} className="text-link hover:underline">
      {label}
    </Link>
  );
}
