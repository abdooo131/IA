'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { setupLink } from '@/lib/hr-phase2';

/**
 * HR phase 2: someone hired with a login who has not chosen a password yet. HR makes a new one
 * time link (the old one stops working) and sees it once to hand over.
 */
export function SetupLinkButton({ employeeId, canUse }: { employeeId: string; canUse: boolean }) {
  const t = useTranslations('hr2');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    const res = await apiSend<{ setupToken: string }>(
      'POST',
      `/hr/employees/${employeeId}/setup-link`,
    );
    setBusy(false);
    if (!res.ok)
      return setError(
        t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t('errors.generic'),
      );
    setLink(setupLink(window.location.origin, res.data.setupToken));
    setCopied(false);
  }

  return (
    <section
      className="mt-4 rounded-lg border border-status-needs-action bg-surface p-4"
      aria-labelledby="login-pending"
    >
      <h2 id="login-pending" className="text-body font-bold">
        {t('setup.pendingTitle')}
      </h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('setup.pendingBody')}</p>
      {link && (
        <div className="mt-3">
          <p className="ltr-iso break-all rounded bg-surface-raised p-2 text-caption">{link}</p>
          <p className="mt-1 text-caption text-text-muted">{t('done.linkHint')}</p>
        </div>
      )}
      {canUse && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void issue()}
            className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50"
          >
            {t('setup.newLink')}
          </button>
          {link && (
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
              onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
            >
              {copied ? t('done.copied') : t('done.copy')}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
