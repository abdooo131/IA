'use client';

import type { DocAttachmentView } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AttachmentField } from '@/components/finance/AttachmentField';
import { apiSend } from '@/lib/api-client';

// Attachments on a document page: each file opens in one click (a photo or a PDF in a new tab),
// the smart button opens the only file at once or a viewer of all of them, and files can be
// added later to the record's entry, payout or request.

const fileUrl = (a: DocAttachmentView) => `/api/photos/${a.photoId}`;
const isPdf = (a: DocAttachmentView) => a.contentType === 'application/pdf';

/** One file: a thumbnail for a photo, a PDF tile with its name; opens in a new tab. */
export function AttachmentTile({
  file,
  label,
  large = false,
}: {
  file: DocAttachmentView;
  label: string;
  large?: boolean;
}) {
  const t = useTranslations('documents.chatter');
  const name = file.fileName ?? (isPdf(file) ? t('pdfFile') : t('photoFile'));
  return (
    <a
      href={fileUrl(file)}
      target="_blank"
      rel="noreferrer"
      className="block"
      title={t('openFile', { name })}
      aria-label={t('openFile', { name })}
    >
      {isPdf(file) ? (
        <span
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-md border border-line bg-surface-raised p-1 text-center ${large ? 'aspect-[3/4]' : 'aspect-square'}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-8 w-8 text-danger" fill="none">
            <path
              d="M6 2h9l5 5v15H6z M15 2v5h5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <text x="12" y="17" textAnchor="middle" fontSize="5.5" fill="currentColor">
              PDF
            </text>
          </svg>
          <span className="w-full truncate text-caption" dir="auto">
            {name}
          </span>
        </span>
      ) : (
        <img
          src={fileUrl(file)}
          alt={label}
          loading="lazy"
          className={`w-full rounded-md border border-line object-cover ${large ? 'aspect-[3/4]' : 'aspect-square'}`}
        />
      )}
    </a>
  );
}

/**
 * The receipts or attachments smart button: no file jumps to the attachments section (to add
 * one), one file opens it directly, several open a viewer listing them all.
 */
export function AttachmentsSmart({
  files,
  label,
  className,
}: {
  files: DocAttachmentView[];
  label: string;
  className: string;
}) {
  const t = useTranslations('documents.chatter');
  const dialog = useRef<HTMLDialogElement>(null);
  const body = (
    <>
      <span className="ltr-iso truncate text-body font-bold text-link sm:max-w-[220px]">
        {files.length}
      </span>
      <span className="truncate text-caption text-text-muted">{label}</span>
    </>
  );
  if (files.length === 0)
    return (
      <a href="#attachments" className={className}>
        {body}
      </a>
    );
  if (files.length === 1)
    return (
      <a href={fileUrl(files[0]!)} target="_blank" rel="noreferrer" className={className}>
        {body}
      </a>
    );
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`${className} w-full text-start`}
      >
        {body}
      </button>
      <dialog
        ref={dialog}
        aria-label={t('viewer')}
        className="w-[min(92vw,900px)] rounded-lg border border-line bg-surface p-4 text-text backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h3">{t('viewer')}</h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="h-10 rounded-md border border-line px-3 text-body-sm font-bold"
          >
            {t('close')}
          </button>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {files.map((f) => (
            <li key={f.photoId}>
              <AttachmentTile file={f} label={label} large />
              <span className="mt-0.5 block truncate text-caption text-text-muted">
                {f.by ?? ''}
              </span>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}

/** Add receipts or documents to a saved record (the earlier "add receipt later"). */
export function AddAttachments({
  target,
}: {
  target: { entryId: string } | { payoutId: string } | { requestId: string };
}) {
  const t = useTranslations('documents.chatter');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [round, setRound] = useState(0);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => {
    if (state === 'done') {
      const timer = setTimeout(() => setState('idle'), 3000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  async function save() {
    setState('busy');
    const r = await apiSend('POST', '/finance/attachments', { ...target, photoIds: ids });
    if (!r.ok) return setState('error');
    setRound((n) => n + 1);
    setState('done');
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold"
        >
          {t('addFiles')}
        </button>
        {state === 'done' && (
          <p role="status" className="mt-1 text-caption text-text-muted">
            {t('filesAdded')}
          </p>
        )}
      </div>
    );
  return (
    <div className="mt-2 space-y-2">
      <AttachmentField onChange={setIds} onBusy={setUploading} resetKey={round} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={ids.length === 0 || uploading || state === 'busy'}
          onClick={() => void save()}
          className="h-10 rounded-md bg-primary px-3 text-body-sm font-bold text-on-primary disabled:opacity-50"
        >
          {t('saveFiles')}
        </button>
        <button
          type="button"
          onClick={() => {
            setRound((n) => n + 1);
            setOpen(false);
          }}
          className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold"
        >
          {t('close')}
        </button>
      </div>
      {state === 'error' && (
        <p role="alert" className="text-caption text-danger">
          {t('errors.generic')}
        </p>
      )}
    </div>
  );
}
