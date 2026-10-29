'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGetClient } from '@/lib/api-client';

/** Tickets in the settings menu, with how many wait unopened. Hidden for merchants. */
export function TicketsLink() {
  const t = useTranslations('tickets');
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void apiGetClient<{ unread: number }>('/tickets?box=inbox').then((r) => {
        if (alive) setUnread(r.ok ? r.data.unread : null);
      });
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (unread === null) return null;
  return (
    <Link
      href="/tickets"
      className="flex h-10 items-center gap-1 rounded-md border border-line bg-surface px-3 text-body-sm font-bold text-link"
    >
      {t('title')}
      {unread > 0 && (
        <span className="rounded-pill bg-status-needs-action px-2 text-caption text-on-primary">
          {unread}
        </span>
      )}
    </Link>
  );
}
