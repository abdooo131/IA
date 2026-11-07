'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { area, danger, Feedback, primary, secondary, useAction } from './kit';

/**
 * The buttons of a waiting item: approve (or apply), refuse with a reason, cancel (a reason when
 * asked), and attach a photo or PDF. Each path is only given when the person may use it.
 */
export function Decision({
  approvePath,
  approveLabel,
  rejectPath,
  cancelPath,
  cancelNeedsReason = false,
  uploadPath,
  uploadLabel,
  approveBody,
  compact = false,
}: {
  approvePath?: string;
  approveLabel?: string;
  rejectPath?: string;
  cancelPath?: string;
  cancelNeedsReason?: boolean;
  uploadPath?: string;
  uploadLabel?: string;
  approveBody?: unknown;
  compact?: boolean;
}) {
  const t = useTranslations('hr3');
  const action = useAction();
  const [mode, setMode] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const size = compact ? ' h-9 px-3' : '';

  async function confirm() {
    const path = mode === 'reject' ? rejectPath : cancelPath;
    if (!path) return;
    const body = mode === 'cancel' && !cancelNeedsReason && !reason ? {} : { reason };
    const ok = await action.send('POST', path, body, t('saved'));
    if (ok) {
      setMode(null);
      setReason('');
    }
  }

  return (
    <div className={compact ? '' : 'mt-3'}>
      <div className="flex flex-wrap gap-2">
        {approvePath && (
          <button
            type="button"
            className={`${primary}${size}`}
            disabled={action.busy}
            onClick={() => void action.send('POST', approvePath, approveBody ?? {}, t('saved'))}
          >
            {approveLabel ?? t('approve')}
          </button>
        )}
        {rejectPath && (
          <button
            type="button"
            className={`${danger}${size}`}
            disabled={action.busy}
            onClick={() => setMode(mode === 'reject' ? null : 'reject')}
          >
            {t('reject')}
          </button>
        )}
        {cancelPath && (
          <button
            type="button"
            className={`${secondary}${size}`}
            disabled={action.busy}
            onClick={() =>
              cancelNeedsReason
                ? setMode(mode === 'cancel' ? null : 'cancel')
                : void action.send('POST', cancelPath, {}, t('saved'))
            }
          >
            {t('cancelRequest')}
          </button>
        )}
        {uploadPath && (
          <label className={`${secondary}${size} cursor-pointer`}>
            {uploadLabel ?? t('attach')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void action.upload(uploadPath, file, t('attached'));
              }}
            />
          </label>
        )}
      </div>
      {mode && (
        <div className="mt-2 max-w-lg">
          <label className="block text-caption">
            {mode === 'reject' ? t('rejectReason') : t('cancelReason')}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={area} />
          </label>
          <button
            type="button"
            className={`${danger} mt-2`}
            disabled={action.busy || reason.trim().length < 3}
            onClick={() => void confirm()}
          >
            {mode === 'reject' ? t('confirmReject') : t('confirmCancel')}
          </button>
        </div>
      )}
      <Feedback error={action.error} done={action.done} />
    </div>
  );
}
