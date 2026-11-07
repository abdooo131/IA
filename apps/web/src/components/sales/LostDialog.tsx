'use client';

import { LOST_REASON_OTHER } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { LostReason } from '@/lib/sales';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * Marking a deal lost asks for a reason from the list, or "other" with a note. The dialog keeps
 * focus inside and closes with Escape.
 */
export function LostDialog({
  company,
  reasons,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  company: string;
  reasons: LostReason[];
  busy: boolean;
  error: string | null;
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const needsNote = reason === LOST_REASON_OTHER;
  const ready = !!reason && (!needsNote || note.trim().length > 0);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="lost-title"
        className="w-full max-w-md space-y-3 rounded-lg bg-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onConfirm(reason, note.trim());
        }}
      >
        <h2 id="lost-title" className="text-h3">
          {t('lost.title', { company })}
        </h2>
        <label className="block text-body-sm">
          <span className="font-semibold">{t('lost.reason')}</span>
          <select
            ref={first}
            className={`${field} mt-1`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          >
            <option value="">{t('lost.pick')}</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {locale === 'ar' ? r.labelAr : r.labelEn}
              </option>
            ))}
            <option value={LOST_REASON_OTHER}>{t('lost.other')}</option>
          </select>
        </label>
        <label className="block text-body-sm">
          <span className="font-semibold">
            {needsNote ? t('lost.noteRequired') : t('lost.note')}
          </span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-surface p-2 text-body-sm"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            required={needsNote}
          />
        </label>
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            className="h-10 rounded-md bg-danger px-4 font-bold text-on-primary disabled:opacity-50"
          >
            {t('lost.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
}
