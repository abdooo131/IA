'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { type DocumentAlert, employeeName } from '@/lib/hr-types';

const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

/** Documents that run out soon or already did: one line each, done once handled. */
export function DocumentAlerts({
  alerts,
  canResolve,
}: {
  alerts: DocumentAlert[];
  canResolve: boolean;
}) {
  const t = useTranslations('hr');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (alerts.length === 0) return null;
  async function resolve(id: string) {
    setBusy(id);
    await apiSend('POST', `/hr/alerts/${id}/resolve`);
    setBusy(null);
    router.refresh();
  }
  return (
    <section
      className="mt-4 max-w-3xl rounded-lg border border-status-needs-action bg-surface p-4"
      aria-labelledby="doc-alerts"
    >
      <h2 id="doc-alerts" className="text-h3">
        {t('alertsTitle')}
      </h2>
      <ul className="mt-2 divide-y divide-line">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 text-body-sm">
              <Link href={`/admin/hr/${a.data.employeeId}`} className="font-bold text-link">
                {employeeName(a.data, locale)}
              </Link>
              {' · '}
              {t(`documentKinds.${a.data.kind}`)}
              <span
                className={`block text-caption ${a.type === 'document_expired' ? 'text-danger' : 'text-text-muted'}`}
              >
                {t(a.type === 'document_expired' ? 'expiredOn' : 'expiresOn', {
                  date: isoToDayFirst(a.data.expiresOn),
                })}
              </span>
            </span>
            {canResolve && (
              <button
                type="button"
                className={button}
                disabled={busy === a.id}
                onClick={() => void resolve(a.id)}
              >
                {t('handled')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens the file of an account that has none, then shows it. */
export function OpenFileButton({ userId }: { userId: string }) {
  const t = useTranslations('hr');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    const result = await apiSend<{ id: string }>('POST', '/hr/employees', { userId });
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    router.push(`/admin/hr/${result.data.id}`);
  }
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-caption text-danger">
          {error}
        </span>
      )}
      <button type="button" className={button} disabled={busy} onClick={() => void open()}>
        {t('openFile')}
      </button>
    </span>
  );
}
