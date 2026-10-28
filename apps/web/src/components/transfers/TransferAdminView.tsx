'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { title } from '@/lib/store-types';
import type { TransferDetail } from '@/lib/transfer-types';
import { TransferRoute } from './TransferRoute';
import { TransferStatusChip } from './TransferStatusChip';

const KNOWN = [
  'not_enough_available',
  'no_lines',
  'invalid_transfer_state',
  'transfer_not_cancellable',
];

/** One transfer for admin: lines, its legs, approve a draft (quantities editable), cancel. */
export function TransferAdminView({ detail }: { detail: TransferDetail }) {
  const t = useTranslations('transfers');
  const locale = useLocale();
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(detail.lines.map((l) => [l.skuId, l.quantity])),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = detail.status === 'draft';

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `/admin/transfers/${detail.id}/${path}`, body);
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    router.refresh();
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="ltr-iso text-h2">{detail.reference}</h1>
        <TransferStatusChip status={detail.status} />
        {detail.origin === 'refill' && (
          <span className="text-caption text-text-muted">{t('auto')}</span>
        )}
      </div>
      <p className="text-body">
        <TransferRoute
          from={detail.from}
          to={detail.to}
          finalDestination={detail.finalDestination}
        />
      </p>
      <p className="text-body-sm text-text-muted">
        <span className="ltr-iso">{formatCairoDateTime(detail.createdAt, locale)}</span>
        {detail.sentAt && (
          <>
            {' · '}
            {t('sentAt', { time: formatCairoDateTime(detail.sentAt, locale) })}
          </>
        )}
        {detail.receivedAt && (
          <>
            {' · '}
            {t('receivedAt', { time: formatCairoDateTime(detail.receivedAt, locale) })}
          </>
        )}
      </p>
      {(detail.previous || detail.next.length > 0) && (
        <p className="text-body-sm">
          {detail.previous && (
            <Link href={`/admin/transfers/${detail.previous.id}`} className="text-link underline">
              {t('previousLeg', { reference: detail.previous.reference })}
            </Link>
          )}{' '}
          {detail.next.map((n) => (
            <Link key={n.id} href={`/admin/transfers/${n.id}`} className="text-link underline">
              {t('nextLeg', { reference: n.reference })}
            </Link>
          ))}
        </p>
      )}
      {detail.note && <p className="text-body-sm">{detail.note}</p>}

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {detail.lines.map((l) => (
          <li key={l.skuId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <span className="min-w-0">
              <span className="ltr-iso block text-body-sm font-bold">{l.sku}</span>
              <span className="block truncate text-body-sm">{title(l, locale)}</span>
              <span className="block text-caption text-text-muted">{l.merchant}</span>
            </span>
            {draft ? (
              <input
                type="number"
                min={0}
                dir="ltr"
                aria-label={t('quantity')}
                value={qty[l.skuId] ?? 0}
                onChange={(e) =>
                  setQty((q) => ({
                    ...q,
                    [l.skuId]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
                className="h-10 w-24 rounded-md border border-line bg-surface px-2 text-body-sm"
              />
            ) : (
              <span className="ltr-iso shrink-0 text-body-sm">
                {t('lineProgress', {
                  asked: l.quantity,
                  sent: l.pickedQty,
                  received: l.receivedQty,
                })}
              </span>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {draft && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act('approve', {
                lines: Object.entries(qty).map(([skuId, quantity]) => ({ skuId, quantity })),
              })
            }
            className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary disabled:opacity-50"
          >
            {t('approve')}
          </button>
        )}
        {(draft || detail.status === 'approved') && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('cancelConfirm'))) void act('cancel', {});
            }}
            className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-danger disabled:opacity-50"
          >
            {t('cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
