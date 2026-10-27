'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { ReturnDetail } from '@/lib/return-types';
import { title } from '@/lib/store-types';
import { ReturnStatusChip } from './ReturnStatusChip';

/** A return as the merchant or admin sees it, with cancel while nothing is picked. */
export function ReturnDetailView({
  detail,
  cancelPath,
}: {
  detail: ReturnDetail;
  cancelPath: string;
}) {
  const t = useTranslations('returns');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function cancel() {
    if (!window.confirm(t('cancelConfirm'))) return;
    setBusy(true);
    setError(false);
    const result = await apiSend('POST', cancelPath, {});
    setBusy(false);
    if (!result.ok) return setError(true);
    router.refresh();
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ltr-iso text-h2">{detail.reference}</h1>
        <ReturnStatusChip status={detail.status} />
      </div>
      <dl className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-surface p-4 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{t('merchant')}</dt>
          <dd>{detail.merchant.name}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('store')}</dt>
          <dd>{localized(detail.darkStore, locale)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('created')}</dt>
          <dd className="ltr-iso">{formatCairoDateTime(detail.createdAt, locale)}</dd>
        </div>
        {detail.collectedAt && (
          <div>
            <dt className="text-text-muted">{t('collected')}</dt>
            <dd>
              <span className="ltr-iso">{formatCairoDateTime(detail.collectedAt, locale)}</span> ·{' '}
              {detail.collectedBy}
            </dd>
          </div>
        )}
        {detail.note && (
          <div className="sm:col-span-2">
            <dt className="text-text-muted">{t('note')}</dt>
            <dd>{detail.note}</dd>
          </div>
        )}
        {detail.cancelReason && (
          <div className="sm:col-span-2">
            <dt className="text-text-muted">{t('cancelReason')}</dt>
            <dd>{detail.cancelReason}</dd>
          </div>
        )}
      </dl>

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {detail.lines.map((l) => (
          <li
            key={`${l.skuId}:${l.source}`}
            className="flex items-center justify-between gap-3 p-3"
          >
            <span className="min-w-0">
              <span className="ltr-iso block text-body-sm font-bold">{l.sku}</span>
              <span className="block truncate text-body-sm">{title(l, locale)}</span>
              <span className="block text-caption text-text-muted">{t(`sources.${l.source}`)}</span>
            </span>
            <span className="ltr-iso shrink-0 text-h3">
              {l.pickedQty}/{l.quantity}
            </span>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {t('errors.return_not_cancellable')}
        </p>
      )}
      {detail.status === 'requested' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel()}
          className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-danger disabled:opacity-50"
        >
          {t('cancel')}
        </button>
      )}
    </div>
  );
}
