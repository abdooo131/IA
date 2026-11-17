'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { connectionLost, nextFailures } from '@/lib/connection';

/** Counts failed polls in a row; `lost` turns true after a few and back as soon as one works. */
export function useConnectionHealth() {
  const [failures, setFailures] = useState(0);
  const report = useCallback((ok: boolean) => setFailures((n) => nextFailures(n, ok)), []);
  return { lost: connectionLost(failures), report };
}

/** The note a polling screen shows while it cannot reach the server. */
export function ConnectionLost({ show }: { show: boolean }) {
  const t = useTranslations('common');
  if (!show) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-status-needs-action bg-surface px-3 py-2 text-body-sm font-bold text-status-needs-action"
    >
      {t('connectionLost')}
    </p>
  );
}
