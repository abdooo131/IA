'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import type { EmailKind, MerchantEmailSettings } from '@/lib/purchasing-types';

const KINDS: EmailKind[] = ['statement', 'payout_paid', 'invoice'];
const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';

/** Where statements, invoices and payout notices are emailed, in which language, and which. */
export function EmailSettingsForm({
  settings,
  path,
  readOnly = false,
}: {
  settings: MerchantEmailSettings;
  path: string;
  readOnly?: boolean;
}) {
  const t = useTranslations('purchasing.emailSettings');
  const router = useRouter();
  const start = settings.billingEmails.join(', ');
  const [emails, setEmails] = useState(start);
  const [language, setLanguage] = useState(settings.language);
  const [optOuts, setOptOuts] = useState<EmailKind[]>(settings.optOuts);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const list = emails
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const dirty =
    emails !== start ||
    language !== settings.language ||
    optOuts.slice().sort().join() !== settings.optOuts.slice().sort().join();

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await apiSend('PUT', path, { billingEmails: list, language, optOuts });
    setBusy(false);
    setMessage(
      result.ok
        ? { text: t('saved'), error: false }
        : { text: result.error === 'validation_failed' ? t('invalid') : t('failed'), error: true },
    );
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-3">
      {settings.configured === false && (
        <p className="text-caption text-status-needs-action">{t('notSetUp')}</p>
      )}
      <label className="block text-caption">
        {t('addresses')}
        <input
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          dir="ltr"
          disabled={readOnly}
          placeholder={settings.contactEmail ?? 'billing@example.com'}
          className={`${field} mt-1`}
        />
        <span className="mt-1 block text-text-muted">
          {t('addressesHint', { contact: settings.contactEmail ?? '—' })}
        </span>
      </label>
      <label className="block text-caption">
        {t('language')}
        <select
          value={language}
          disabled={readOnly}
          onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}
          className={`${field} mt-1`}
        >
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </label>
      <fieldset className="space-y-1 text-body-sm">
        <legend className="text-caption">{t('which')}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={!optOuts.includes(k)}
              onChange={(e) =>
                setOptOuts((o) => (e.target.checked ? o.filter((x) => x !== k) : [...o, k]))
              }
            />
            {t(`kinds.${k}`)}
          </label>
        ))}
      </fieldset>
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
      {!readOnly && (
        <FormFooter
          dirty={dirty}
          busy={busy}
          onSave={() => void save()}
          onCancel={() => {
            setEmails(start);
            setLanguage(settings.language);
            setOptOuts(settings.optOuts);
          }}
        />
      )}
    </div>
  );
}
