'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type DragEvent, useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { fileSize, type UploadType } from '@/lib/hr-phase2';
import { shrinkPhoto } from '@/lib/photo';

interface Queued {
  key: string;
  file: File;
  typeId: string | null;
  expiresOn: string;
  status: 'ready' | 'sending' | 'done' | 'error';
  error: string | null;
}

let counter = 0;

/**
 * HR phase 2: drop several files at once (or choose them, or take photos with the phone
 * camera), give each one its type with one tap from the person's missing types, and send them
 * all. Photos are shrunk on the phone first, like every upload. `uploadPath` is the API address
 * the file is POSTed to with its type and dates in the query.
 */
export function MultiUpload({
  uploadPath,
  types,
  onUploaded,
  title,
}: {
  uploadPath: string;
  types: UploadType[];
  onUploaded: () => void;
  title?: string;
}) {
  const t = useTranslations('hr2');
  const tp = useTranslations('people');
  const locale = useLocale();
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const suggested = types.filter((x) => x.suggested);
  const others = types.filter((x) => !x.suggested);
  const typeOf = (id: string | null) => types.find((x) => x.id === id) ?? null;

  function add(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 20);
    setQueue((q) => [
      ...q.filter((x) => x.status !== 'done'),
      ...list.map((file) => ({
        key: `f${++counter}`,
        file,
        typeId: null,
        expiresOn: '',
        status: 'ready' as const,
        error: null,
      })),
    ]);
    if (picker.current) picker.current.value = '';
    if (camera.current) camera.current.value = '';
  }
  const set = (key: string, patch: Partial<Queued>) =>
    setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  }

  const ready = queue.filter((x) => x.status !== 'done');
  const missingType = ready.some((x) => !x.typeId);
  const missingDate = ready.some((x) => typeOf(x.typeId)?.hasExpiry && !x.expiresOn);

  async function sendOne(item: Queued): Promise<boolean> {
    const type = typeOf(item.typeId);
    if (!type) return false;
    set(item.key, { status: 'sending', error: null });
    let body: Blob = item.file;
    if (item.file.type.startsWith('image/'))
      body = await shrinkPhoto(item.file, 2000, 0.8).catch(() => item.file);
    const contentType = body.type || item.file.type || 'application/pdf';
    if (!type.allowedTypes.includes(contentType)) {
      set(item.key, { status: 'error', error: tp('errors.document_type_not_allowed') });
      return false;
    }
    if (body.size > type.maxBytes) {
      set(item.key, { status: 'error', error: tp('errors.document_too_large') });
      return false;
    }
    const query = new URLSearchParams({ typeId: type.id });
    if (item.expiresOn) query.set('expiresOn', item.expiresOn);
    try {
      const res = await fetch(`/api${uploadPath}?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const code = data.error ?? 'generic';
        set(item.key, {
          status: 'error',
          error: tp.has(`errors.${code}`) ? tp(`errors.${code}`) : tp('errors.generic'),
        });
        return false;
      }
      set(item.key, { status: 'done' });
      return true;
    } catch {
      set(item.key, { status: 'error', error: tp('errors.generic') });
      return false;
    }
  }

  async function sendAll() {
    setBusy(true);
    let sent = 0;
    for (const item of ready) if (await sendOne(item)) sent++;
    setBusy(false);
    if (sent > 0) onUploaded();
  }

  const chip = (selected: boolean) =>
    `inline-flex min-h-9 items-center rounded-pill border px-3 text-caption font-bold ${
      selected
        ? 'border-primary bg-primary text-on-primary'
        : 'border-line bg-surface text-text hover:border-primary'
    }`;

  return (
    <section
      className="rounded-lg border border-line bg-surface p-4"
      aria-label={title ?? t('docs.dropTitle')}
    >
      <h3 className="text-body font-bold">{title ?? t('docs.dropTitle')}</h3>
      <div
        role="group"
        aria-label={t('docs.dropZone')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`mt-2 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-6 text-center ${
          over ? 'border-primary bg-surface-raised' : 'border-line'
        }`}
      >
        <p className="text-body-sm text-text-muted">{t('docs.dropHint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
            onClick={() => camera.current?.click()}
          >
            {tp('takePhoto')}
          </button>
          <button
            type="button"
            className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
            onClick={() => picker.current?.click()}
          >
            {t('docs.chooseFiles')}
          </button>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => add(e.target.files)}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => add(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 space-y-3">
          {queue.map((item) => {
            const type = typeOf(item.typeId);
            return (
              <li key={item.key} className="min-w-0 rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-body-sm">
                    <span className="block truncate font-bold">{item.file.name}</span>
                    <span className="ltr-iso text-caption text-text-muted">
                      {fileSize(item.file.size)}
                    </span>
                  </span>
                  {item.status === 'done' ? (
                    <span className="text-caption font-bold text-status-delivered">
                      {t('docs.sent')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-caption font-bold text-danger"
                      disabled={item.status === 'sending'}
                      onClick={() => setQueue((q) => q.filter((x) => x.key !== item.key))}
                    >
                      {t('docs.removeFile')}
                    </button>
                  )}
                </div>
                {item.status !== 'done' && (
                  <>
                    <p className="mt-2 text-caption text-text-muted">{t('docs.whichType')}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {suggested.map((ty) => (
                        <button
                          key={ty.id}
                          type="button"
                          aria-pressed={item.typeId === ty.id}
                          className={chip(item.typeId === ty.id)}
                          onClick={() => set(item.key, { typeId: ty.id })}
                        >
                          {name(ty)}
                        </button>
                      ))}
                      {others.length > 0 && (
                        <select
                          aria-label={t('docs.otherType')}
                          value={others.some((o) => o.id === item.typeId) ? item.typeId! : ''}
                          onChange={(e) => set(item.key, { typeId: e.target.value || null })}
                          className="h-9 max-w-full rounded-pill border border-line bg-surface px-3 text-caption"
                        >
                          <option value="">{t('docs.otherType')}</option>
                          {others.map((o) => (
                            <option key={o.id} value={o.id}>
                              {name(o)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {type?.hasExpiry && (
                      <label className="mt-2 block text-caption">
                        {tp('expiresOn')} <span className="text-danger">*</span>
                        <span className="mt-1 block">
                          <DateInput
                            value={item.expiresOn}
                            onChange={(e) => set(item.key, { expiresOn: e.target.value })}
                            className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
                          />
                        </span>
                      </label>
                    )}
                  </>
                )}
                {item.error && (
                  <p role="alert" className="mt-2 text-caption text-danger">
                    {item.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {ready.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50"
            disabled={busy || missingType || missingDate}
            onClick={() => void sendAll()}
          >
            {busy ? t('docs.sending') : t('docs.sendAll', { count: ready.length })}
          </button>
          {(missingType || missingDate) && (
            <span className="text-caption text-text-muted">
              {missingType ? t('docs.pickTypes') : t('docs.pickDates')}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
