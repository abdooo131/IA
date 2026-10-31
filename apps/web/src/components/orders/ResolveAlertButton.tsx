'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

export function ResolveAlertButton({ alertId }: { alertId: string }) {
  const t = useTranslations('admin.alerts');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiSend('POST', `/admin/alerts/${alertId}/resolve`, {});
        setBusy(false);
        router.refresh();
      }}
      className="h-9 rounded-md bg-selected-bg px-3 text-body-sm font-bold text-link disabled:opacity-50"
    >
      {t('resolve')}
    </button>
  );
}
