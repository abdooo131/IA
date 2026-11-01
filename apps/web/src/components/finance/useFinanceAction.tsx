'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

/** Sends one finance action, shows its result and refreshes the page data. */
export function useFinanceAction() {
  const t = useTranslations('finance');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function send<T>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    done?: (data: T) => string,
  ) {
    setBusy(true);
    setMessage(null);
    const result = await apiSend<T>(method, path, body);
    setBusy(false);
    if (!result.ok) {
      setMessage({
        text: t(
          t.has(`merchants.errors.${result.error}`)
            ? `merchants.errors.${result.error}`
            : 'merchants.errors.generic',
        ),
        error: true,
      });
      return null;
    }
    // Large or money in movements wait for a second person instead of posting.
    const pending = (result.data as { status?: string } | null)?.status === 'pending';
    setMessage({
      text: pending ? t('sentForApproval') : done ? done(result.data) : t('done'),
      error: false,
    });
    router.refresh();
    return result.data;
  }

  return { busy, message, setMessage, send };
}

export function ActionMessage({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
    >
      {message.text}
    </p>
  );
}
