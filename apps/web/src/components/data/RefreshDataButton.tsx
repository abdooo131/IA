'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

/** Collect the whole store again from the start (it runs in the background). */
export function RefreshDataButton({ merchantId }: { merchantId: string }) {
  const t = useTranslations('data');
  const [state, setState] = useState<'idle' | 'busy' | 'queued' | 'error'>('idle');
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === 'busy'}
        className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50"
        onClick={async () => {
          if (!window.confirm(t('refreshConfirm'))) return;
          setState('busy');
          const r = await apiSend('POST', `/admin/data/merchants/${merchantId}/refresh`, {});
          setState(r.ok ? 'queued' : 'error');
        }}
      >
        {t('refresh')}
      </button>
      {state === 'queued' && (
        <span className="text-caption text-text-muted">{t('refreshQueued')}</span>
      )}
      {state === 'error' && <span className="text-caption text-danger">{t('error')}</span>}
    </div>
  );
}
