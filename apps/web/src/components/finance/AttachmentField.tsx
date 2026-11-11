'use client';

import { useTranslations } from 'next-intl';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { shrinkPhoto } from '@/lib/photo';

/** Most files one form takes, and the largest PDF (photos are shrunk in the browser first). */
const MAX_FILES = 10;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface Item {
  key: string;
  name: string;
  type: string;
  /** A local preview of a photo */
  preview: string | null;
  id: string | null;
  state: 'busy' | 'done' | 'error';
}

async function upload(blob: Blob, name: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/finance/files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return res.ok && data.id ? data.id : null;
  } catch {
    return null;
  }
}

/**
 * The attachment field of a form kept in React state: `ids` go in the body as attachmentIds,
 * `busy` holds the save while files upload, `reset()` empties it after a save.
 */
export function useAttachments() {
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const field = (props: { required?: boolean } = {}) => (
    <AttachmentField onChange={setIds} onBusy={setBusy} resetKey={round} {...props} />
  );
  return { ids, busy, field, reset: () => setRound((r) => r + 1) };
}

/**
 * Receipts and documents chosen inside a finance form, before it is saved: pick or drop one or
 * more files, or take a photo with the phone. Photos are shrunk like every receipt photo, PDFs go
 * as they are (at most 5 MB). Each file is uploaded at once (POST /finance/files) and waits
 * unlinked; the form sends the ids (hidden inputs named `attachmentIds`, or `onChange`) and its
 * save links them in the same transaction. A file removed before saving is deleted. The field
 * clears itself when its form is reset, and a native form cannot be sent while files upload
 * (or, with `required`, before one is added).
 */
export function AttachmentField({
  onChange,
  onBusy,
  required = false,
  name = 'attachmentIds',
  resetKey,
}: {
  onChange?: (ids: string[]) => void;
  onBusy?: (busy: boolean) => void;
  required?: boolean;
  name?: string;
  /** Changing it empties the field (forms that are not reset natively) */
  resetKey?: unknown;
}) {
  const t = useTranslations('attachments');
  const anchor = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  const busy = items.some((i) => i.state === 'busy');

  const clear = () => {
    setItems((all) => {
      for (const i of all) if (i.preview) URL.revokeObjectURL(i.preview);
      return [];
    });
    setError(null);
  };

  useEffect(() => {
    const form = anchor.current?.form;
    if (!form) return;
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, []);

  useEffect(() => {
    if (resetKey !== undefined) clear();
  }, [resetKey]);

  const idsKey = ids.join(',');
  // The parent hears of the ids when they change (its callback may be a new function each time).
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    changed.current?.(idsKey ? idsKey.split(',') : []);
  }, [idsKey]);
  useEffect(() => onBusy?.(busy), [busy, onBusy]);

  // Native forms wait for uploads, and for one file when it is required.
  useEffect(() => {
    anchor.current?.setCustomValidity(
      busy ? t('waitUpload') : required && ids.length === 0 ? t('required') : '',
    );
  }, [busy, required, ids.length, t]);

  async function add(files: FileList | File[] | null) {
    if (!files) return;
    setError(null);
    const list = Array.from(files);
    if (items.length + list.length > MAX_FILES) setError(t('tooMany'));
    for (const file of list.slice(0, Math.max(0, MAX_FILES - items.length))) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImage = IMAGE_TYPES.includes(file.type) || /^image\//.test(file.type);
      if (!isPdf && !isImage) {
        setError(t('wrongType', { name: file.name }));
        continue;
      }
      if (isPdf && file.size > MAX_PDF_BYTES) {
        setError(t('tooLarge', { name: file.name }));
        continue;
      }
      const key = `${Date.now()}-${Math.random()}`;
      const preview = isImage ? URL.createObjectURL(file) : null;
      setItems((all) => [
        ...all,
        {
          key,
          name: file.name,
          type: isPdf ? 'application/pdf' : 'image/jpeg',
          preview,
          id: null,
          state: 'busy',
        },
      ]);
      const blob = isPdf
        ? new Blob([file], { type: 'application/pdf' })
        : await shrinkPhoto(file).catch(() => file);
      const id = await upload(blob, file.name);
      setItems((all) =>
        all.map((i) => (i.key === key ? { ...i, id, state: id ? 'done' : 'error' } : i)),
      );
      if (!id) setError(t('failed'));
    }
  }

  function remove(item: Item) {
    if (item.preview) URL.revokeObjectURL(item.preview);
    setItems((all) => all.filter((i) => i.key !== item.key));
    // The upload is no longer wanted: delete it now (the daily job would anyway).
    if (item.id) void fetch(`/api/finance/files/${item.id}`, { method: 'DELETE' }).catch(() => {});
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    void add(e.dataTransfer.files);
  }

  return (
    <div className="w-full text-caption sm:col-span-2">
      <span className="block">
        {t('label')}
        {required ? ' *' : ''}
      </span>
      <input
        ref={anchor}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        value={idsKey}
        onChange={() => undefined}
        onInvalid={(e) => {
          e.preventDefault();
          setError(busy ? t('waitUpload') : t('required'));
        }}
      />
      {ids.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`mt-1 rounded-md border border-dashed p-3 ${over ? 'border-primary bg-surface-raised' : 'border-line-strong bg-surface'}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={items.length >= MAX_FILES}
            className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50"
          >
            {t('choose')}
          </button>
          <button
            type="button"
            onClick={() => camera.current?.click()}
            disabled={items.length >= MAX_FILES}
            className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50"
          >
            {t('camera')}
          </button>
          <span className="text-text-muted">{t('drop')}</span>
        </div>
        <p className="mt-1 text-text-muted">{t('hint')}</p>
        <input
          ref={picker}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('choose')}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('camera')}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = '';
          }}
        />
        {items.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {items.map((i) => (
              <li
                key={i.key}
                className={`relative w-24 rounded-md border p-1 ${i.state === 'error' ? 'border-danger' : 'border-line'}`}
              >
                {i.preview ? (
                  <img src={i.preview} alt={i.name} className="h-16 w-full rounded object-cover" />
                ) : (
                  <span className="flex h-16 w-full items-center justify-center rounded bg-surface-raised font-bold text-danger">
                    {t('pdf')}
                  </span>
                )}
                <span className="mt-0.5 block truncate" dir="auto" title={i.name}>
                  {i.state === 'busy' ? t('uploading') : i.name}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={t('remove', { name: i.name })}
                  className="absolute end-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-body-sm font-bold"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
