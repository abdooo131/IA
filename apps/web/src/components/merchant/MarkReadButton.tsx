'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { apiSend } from '@/lib/api-client';

export function MarkReadButton({ id }: { id: string }) {
  const t = useTranslations('merchant.notifications');
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await apiSend('POST', `/merchant/notifications/${id}/read`, {});
        router.refresh();
      }}
      className="mt-3 h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
    >
      {t('markRead')}
    </button>
  );
}
