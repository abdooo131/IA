'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

const KNOWN = ['invalid_return_state', 'validation_failed', 'no_access', 'network'];

/**
 * Some units of a return cannot be found: a store or inventory manager closes it short with a
 * reason. Units not picked go back on sale (or stop being claimed), the shortfall is recorded
 * with an alert and the return is ready to hand over with what was picked.
 */
export function CloseShortPanel({ path, onDone }: { path: string; onDone: () => void }) {
  const t = useTranslations('returns');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!window.confirm(t('closeShortConfirm'))) return;
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', path, { reason });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setOpen(false);
    onDone();
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-danger"
      >
        {t('closeShort')}
      </button>
    );
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <p className="text-body-sm">{t('closeShortHint')}</p>
      <label className="block text-body-sm font-bold">
        {t('closeShortReason')}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={2}
          className="mt-1 block w-full rounded-md border border-line-strong bg-surface p-2 font-normal"
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || reason.trim().length < 5}
          onClick={() => void submit()}
          className="h-10 rounded-md bg-danger px-4 text-body-sm font-bold text-on-status disabled:bg-line disabled:text-text-muted"
        >
          {t('closeShort')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {t('closeShortBack')}
        </button>
      </div>
    </section>
  );
}
