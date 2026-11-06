'use client';

import { DOCUMENT_KINDS, type DocumentKind, MAX_DOCUMENT_BYTES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import type { EmployeeDocument } from '@/lib/hr-types';
import { shrinkPhoto } from '@/lib/photo';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const KNOWN = [
  'document_type_not_allowed',
  'document_too_large',
  'document_not_readable',
  'expires_before_issued',
  'validation_failed',
];

async function upload(
  employeeId: string,
  file: Blob,
  meta: { kind: DocumentKind; title: string; issuedOn: string; expiresOn: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const query = new URLSearchParams({ kind: meta.kind });
  if (meta.title.trim()) query.set('title', meta.title.trim());
  if (meta.issuedOn) query.set('issuedOn', meta.issuedOn);
  if (meta.expiresOn) query.set('expiresOn', meta.expiresOn);
  try {
    const res = await fetch(`/api/hr/employees/${employeeId}/documents?${query.toString()}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/pdf' },
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * The scanned documents of a file: a phone photo (shrunk before upload) or a PDF of at most
 * 3 MB, with issue and expiry dates. `downloadBase` is where a document opens from; without
 * `employeeId` the list is read only (My HR).
 */
export function DocumentsPanel({
  documents,
  downloadBase,
  employeeId,
  canDelete = false,
  today,
}: {
  documents: EmployeeDocument[];
  downloadBase: string;
  employeeId?: string;
  canDelete?: boolean;
  today: string;
}) {
  const t = useTranslations('hr');
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('national_id');
  const [title, setTitle] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(file: File | undefined) {
    if (!file || !employeeId) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    let body: Blob = file;
    if (file.type.startsWith('image/')) body = await shrinkPhoto(file, 2000, 0.8).catch(() => file);
    if (body.size > MAX_DOCUMENT_BYTES) {
      setBusy(false);
      return setError(t('errors.document_too_large'));
    }
    const result = await upload(employeeId, body, { kind, title, issuedOn, expiresOn });
    setBusy(false);
    if (camera.current) camera.current.value = '';
    if (picker.current) picker.current.value = '';
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setTitle('');
    setIssuedOn('');
    setExpiresOn('');
    setNotice(t('uploaded'));
    router.refresh();
  }

  async function remove(doc: EmployeeDocument) {
    if (!employeeId || !window.confirm(t('deleteConfirm'))) return;
    setBusy(true);
    const result = await apiSend('DELETE', `/hr/employees/${employeeId}/documents/${doc.id}`);
    setBusy(false);
    if (!result.ok) return setError(t('errors.generic'));
    router.refresh();
  }

  return (
    <div className="mt-4 max-w-3xl space-y-4">
      {documents.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('noDocuments')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {documents.map((d) => {
            const expired = !!d.expiresOn && d.expiresOn < today;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <span className="font-bold">{t(`documentKinds.${d.kind}`)}</span>
                  {d.title && <span className="text-text-muted"> · {d.title}</span>}
                  <span className="block text-caption text-text-muted">
                    {d.issuedOn && (
                      <>
                        {t('issued', { date: isoToDayFirst(d.issuedOn) })}
                        {' · '}
                      </>
                    )}
                    {d.expiresOn ? (
                      <span className={expired ? 'font-bold text-danger' : undefined}>
                        {t(expired ? 'expiredOn' : 'expiresOn', {
                          date: isoToDayFirst(d.expiresOn),
                        })}
                      </span>
                    ) : (
                      t('noExpiry')
                    )}
                    {' · '}
                    {d.contentType === 'application/pdf' ? 'PDF' : t('photo')}
                    {' · '}
                    {t('uploadedBy', { name: d.uploadedBy.name })}
                  </span>
                </span>
                <span className="flex gap-2">
                  <a
                    href={`${downloadBase}/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={button}
                  >
                    {t('open')}
                  </a>
                  {canDelete && (
                    <button
                      type="button"
                      className={`${button} text-danger`}
                      disabled={busy}
                      onClick={() => void remove(d)}
                    >
                      {t('delete')}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {employeeId && (
        <section className="rounded-lg border border-line p-4" aria-labelledby="add-doc">
          <h2 id="add-doc" className="text-h3">
            {t('addDocument')}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-caption">
              {t('documentKind')}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as DocumentKind)}
                className={field}
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`documentKinds.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption">
              {t('documentTitle')}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('fields.issuedOn')}
              <span className="mt-1 block">
                <DateInput
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                  className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
                />
              </span>
            </label>
            <label className="block text-caption">
              {t('fields.expiresOn')}
              <span className="mt-1 block">
                <DateInput
                  value={expiresOn}
                  onChange={(e) => setExpiresOn(e.target.value)}
                  className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text"
                />
              </span>
            </label>
          </div>
          <p className="mt-2 text-caption text-text-muted">{t('uploadHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => void send(e.target.files?.[0])}
            />
            <input
              ref={picker}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => void send(e.target.files?.[0])}
            />
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
              disabled={busy}
              onClick={() => camera.current?.click()}
            >
              {t('takePhoto')}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              {t('chooseFile')}
            </button>
          </div>
          {busy && <p className="mt-2 text-body-sm text-text-muted">{t('uploading')}</p>}
        </section>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-sm">
          {notice}
        </p>
      )}
    </div>
  );
}
