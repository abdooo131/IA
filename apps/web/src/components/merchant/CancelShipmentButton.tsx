'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

export function CancelShipmentButton({ id }: { id: string }) {
  const t = useTranslations('merchant.shipments');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiSend('POST', `/merchant/manifests/${id}/cancel`, {});
        router.refresh();
      }}
      className="mt-3 h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
    >
      {t('cancel')}
    </button>
  );
}
