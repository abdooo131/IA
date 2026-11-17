'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatCairoDateTime } from '@/lib/format';
import type { Violation } from '@/lib/leave-types';
import { area, Feedback, primary, secondary, useAction } from './kit';
import { ViolationsTable } from './ViolationsTable';

function Appeal({ v }: { v: Violation }) {
  const t = useTranslations('hr3');
  const locale = useLocale();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!v.canAppeal)
    return v.appealReason ? (
      <span className="text-caption text-text-muted">{t('appealSent')}</span>
    ) : null;
  return (
    <div>
      <button type="button" className={`${secondary} h-9 px-3`} onClick={() => setOpen(!open)}>
        {t('appeal')}
      </button>
      <span className="mt-1 block text-caption text-text-muted">
        {t('appealUntil', { at: formatCairoDateTime(v.appealUntil, locale) })}
      </span>
      {open && (
        <div className="mt-2 text-start">
          <label className="block text-caption">
            {t('appealReason')}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={area} />
          </label>
          <button
            type="button"
            className={`${primary} mt-2`}
            disabled={action.busy || reason.trim().length < 3}
            onClick={() =>
              void action.send('POST', `/me/violations/${v.id}/appeal`, { reason }, t('appealSent'))
            }
          >
            {t('sendAppeal')}
          </button>
        </div>
      )}
      <Feedback error={action.error} done={action.done} />
    </div>
  );
}

/** My HR violations: each with its penalty and status; an appeal while the window is open. */
export function MyViolationsView({ rows }: { rows: Violation[] }) {
  return <ViolationsTable rows={rows} showPerson={false} actions={(v) => <Appeal v={v} />} />;
}
