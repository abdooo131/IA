'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MissingReceipt } from '@/lib/finance-types';
import { formatCairoDateTime } from '@/lib/format';
import { Amount } from './Amount';
import { ReceiptField } from './ReceiptField';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

function Row({ entry }: { entry: MissingReceipt }) {
  const t = useTranslations('finance');
  const locale = useLocale();
  const action = useFinanceAction();
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <li className="space-y-2 px-3 py-3 text-body-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          <span className="ltr-iso me-2 font-bold text-link">
            JV-{String(entry.number).padStart(6, '0')}
          </span>
          {t.has(`kinds.${entry.kind}`) ? t(`kinds.${entry.kind}`) : entry.kind}
          {entry.memo && <span className="text-text-muted"> · {entry.memo}</span>}
        </span>
        <span className="text-text-muted">
          <Amount piastres={entry.amountPiastres} /> EGP ·{' '}
          <span className="ltr-iso">{formatCairoDateTime(entry.at, locale)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ReceiptField onChange={setPhoto} />
        <button
          type="button"
          disabled={!photo || action.busy}
          onClick={() =>
            void action.send('POST', '/finance/attachments', { entryId: entry.id, photoId: photo })
          }
          className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
        >
          {t('receipts.save')}
        </button>
      </div>
      <ActionMessage message={action.message} />
    </li>
  );
}

/** Money movements an auditor would ask a receipt or transfer slip for, still without one. */
export function MissingReceipts({ entries }: { entries: MissingReceipt[] }) {
  const t = useTranslations('finance.receipts');
  if (entries.length === 0) return <p className="mt-4 text-body text-text-muted">{t('allDone')}</p>;
  return (
    <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
      {entries.map((e) => (
        <Row key={e.id} entry={e} />
      ))}
    </ul>
  );
}
