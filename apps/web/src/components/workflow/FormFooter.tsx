'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useUnsavedChanges } from './useUnsavedChanges';

const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const button =
  'h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50';

/**
 * Save and Cancel for a form, with its saved state: "Unsaved changes" while edited, and a
 * question before Cancel or leaving throws the changes away. Cancel goes to `cancelHref`, or
 * back one page, or runs `onCancel`.
 */
export function FormFooter({
  dirty,
  busy = false,
  saveLabel,
  disabled = false,
  cancelHref,
  onCancel,
  onSave,
}: {
  dirty: boolean;
  busy?: boolean;
  saveLabel?: string;
  disabled?: boolean;
  cancelHref?: string;
  onCancel?: () => void;
  /** Without it the Save button submits the surrounding form */
  onSave?: () => void;
}) {
  const t = useTranslations('workflow');
  const router = useRouter();
  useUnsavedChanges(dirty && !busy);
  function cancel() {
    if (dirty && !window.confirm(t('discardConfirm'))) return;
    if (onCancel) onCancel();
    else if (cancelHref) router.push(cancelHref);
    else router.back();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type={onSave ? 'button' : 'submit'}
        className={primary}
        disabled={busy || disabled}
        onClick={onSave}
      >
        {busy ? t('saving') : (saveLabel ?? t('save'))}
      </button>
      <button type="button" className={button} onClick={cancel} disabled={busy}>
        {t('cancel')}
      </button>
      <span
        role="status"
        className={`text-caption ${dirty ? 'font-bold text-status-needs-action' : 'text-text-muted'}`}
      >
        {dirty ? t('unsaved') : ''}
      </span>
    </div>
  );
}
