'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

const KNOWN = ['would_break_reservations', 'count_already_reviewed'];

export function CountReviewButtons({ id }: { id: string }) {
  const t = useTranslations('admin.counts');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(kind: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/admin/stock-counts/${id}/${kind}`, {});
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => review('approve')}
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('approve')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => review('reject')}
          className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {t('reject')}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
