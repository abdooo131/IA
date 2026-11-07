'use client';

import type { DocumentState } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import type {
  ChecklistItem,
  DocumentChecklist,
  DocumentTypeRow,
  EmployeeDocument,
} from '@/lib/hr-types';
import { shrinkPhoto } from '@/lib/photo';
import type { UploadType } from '@/lib/hr-phase2';
import { MultiUpload } from './MultiUpload';

/** States HR may remind the person about (HR phase 2). */
const REMINDABLE: DocumentState[] = ['missing', 'rejected', 'expired', 'expiring'];

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const dateBox = 'h-10 rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** Colors of a document's state, from the status palette. */
export const STATE_TONE: Record<DocumentState, string> = {
  missing: 'border-danger text-danger',
  rejected: 'border-danger text-danger',
  expired: 'border-danger text-danger',
  pending: 'border-status-needs-action text-status-needs-action',
  expiring: 'border-status-needs-action text-status-needs-action',
  verified: 'border-status-delivered text-status-delivered',
};

export function StateChip({ state }: { state: DocumentState }) {
  const t = useTranslations('people');
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill border px-2 py-0.5 text-caption font-bold ${STATE_TONE[state]}`}
    >
      {t(`states.${state}`)}
    </span>
  );
}

/** A bar of how many required documents are in order. */
export function CompletenessBar({
  percent,
  done,
  required,
}: {
  percent: number;
  done: number;
  required: number;
}) {
  const t = useTranslations('people');
  const tone =
    percent === 100
      ? 'bg-status-delivered'
      : percent >= 50
        ? 'bg-status-needs-action'
        : 'bg-danger';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-body-sm">
        <span className="font-bold">{t('completeTitle')}</span>
        <span className="ltr-iso font-bold">{percent}%</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-pill bg-surface-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={t('completeTitle')}
      >
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-caption text-text-muted">{t('complete', { done, required })}</p>
    </div>
  );
}

type Mode =
  { kind: 'hr'; employeeId: string; canUse: boolean; canManage: boolean } | { kind: 'self' };

interface UploadTarget {
  typeId: string;
  replacesId?: string;
  hasExpiry: boolean;
  allowedTypes: string[];
  maxBytes: number;
}

/**
 * The document checklist of a file: every required type with its state, the current document
 * and its older versions, preview and download, HR verification, uploads (a new version keeps
 * the old one) and, in My HR, the person's own upload of what is missing or refused.
 */
export function DocumentsPanel({
  checklist,
  documents,
  types,
  mode,
}: {
  checklist: DocumentChecklist;
  documents: EmployeeDocument[];
  /** Every active type the uploader may add (HR) */
  types?: DocumentTypeRow[];
  mode: Mode;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const router = useRouter();
  const base =
    mode.kind === 'hr' ? `/hr/employees/${mode.employeeId}/documents` : '/me/employee/documents';
  const canUpload = mode.kind === 'self' || mode.canUse;
  const [target, setTarget] = useState<UploadTarget | null>(null);
  const [preview, setPreview] = useState<EmployeeDocument | null>(null);
  const [rejecting, setRejecting] = useState<EmployeeDocument | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const fail = (code: string) =>
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function review(doc: EmployeeDocument, status: 'verified' | 'rejected', note?: string) {
    if (mode.kind !== 'hr') return;
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `${base}/${doc.id}/review`, { status, note });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setRejecting(null);
    router.refresh();
  }

  async function remove(doc: EmployeeDocument) {
    if (mode.kind !== 'hr' || !window.confirm(t('deleteConfirm'))) return;
    setBusy(true);
    const result = await apiSend('DELETE', `${base}/${doc.id}`);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    router.refresh();
  }

  const selfCan = (i: ChecklistItem) =>
    i.type.selfUpload &&
    !i.type.confidential &&
    ['missing', 'rejected', 'expired', 'expiring'].includes(i.state);

  const shown = checklist.items;
  const others = (types ?? []).filter(
    (ty) => ty.isActive && !shown.some((i) => i.type.id === ty.id && !ty.multiple),
  );

  // HR phase 2: several files at once, each given a type from what the person is missing.
  const missingTypes = shown.filter((i) => REMINDABLE.includes(i.state)).map((i) => i.type);
  const uploadTypes: UploadType[] = [
    ...missingTypes.map((ty) => ({ ...ty, suggested: true })),
    ...(types ?? [])
      .filter((ty) => ty.isActive && !missingTypes.some((m) => m.id === ty.id))
      .map((ty) => ({
        id: ty.id,
        nameEn: ty.nameEn,
        nameAr: ty.nameAr,
        hasExpiry: ty.hasExpiry,
        allowedTypes: ty.allowedTypes,
        maxBytes: ty.maxBytes,
        suggested: false,
      })),
  ];
  const remindableCount = shown.filter((i) => i.required && REMINDABLE.includes(i.state)).length;

  async function remind(typeId: string | null) {
    if (mode.kind !== 'hr') return;
    setBusy(true);
    setError(null);
    const result = await apiSend<{ sent: boolean | number; alreadyToday: boolean | number }>(
      'POST',
      `/hr/employees/${mode.employeeId}/documents/${typeId ? 'remind' : 'remind-all'}`,
      typeId ? { typeId } : undefined,
    );
    setBusy(false);
    if (!result.ok) return fail(result.error);
    const sent = Number(result.data.sent);
    setNotice(sent > 0 ? t('reminded', { count: sent }) : t('remindedAlready'));
  }

  const docLine = (d: EmployeeDocument, current: boolean) => (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 text-caption text-text-muted">
        <span className="font-bold text-text">
          {t('version', { n: d.version })}
          {d.title && <> · {d.title}</>}
        </span>
        {!current && <> · {t('olderVersion')}</>}
        <span className="block">
          {d.expiresOn
            ? t(d.expiresOn < new Date().toISOString().slice(0, 10) ? 'expired' : 'expires', {
                date: isoToDayFirst(d.expiresOn),
              })
            : t('noExpiry')}
          {' · '}
          {d.contentType === 'application/pdf' ? 'PDF' : t('image')}
          {' · '}
          {t('uploadedBy', {
            name: d.uploadedBy.name,
            date: isoToDayFirst(d.createdAt.slice(0, 10)),
          })}
          {d.selfUploaded && <> · {t('selfUploaded')}</>}
        </span>
        {d.status === 'rejected' && d.reviewNote && (
          <span className="mt-1 block font-bold text-danger">
            {t('reviewNote', { note: d.reviewNote })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setPreview(d)}>
          {t('preview')}
        </button>
        <a className={button} href={`/api${base}/${d.id}?download=1`}>
          {t('download')}
        </a>
        {mode.kind === 'hr' && mode.canUse && current && d.status !== 'verified' && (
          <button
            type="button"
            className={`${button} border-status-delivered text-status-delivered`}
            disabled={busy}
            onClick={() => void review(d, 'verified')}
          >
            {t('verify')}
          </button>
        )}
        {mode.kind === 'hr' && mode.canUse && current && d.status !== 'rejected' && (
          <button
            type="button"
            className={`${button} text-danger`}
            disabled={busy}
            onClick={() => setRejecting(d)}
          >
            {t('reject')}
          </button>
        )}
        {mode.kind === 'hr' && mode.canManage && (
          <button
            type="button"
            className={`${button} text-danger`}
            disabled={busy}
            onClick={() => void remove(d)}
            aria-label={t('delete')}
          >
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mt-4 max-w-4xl space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <CompletenessBar
          percent={checklist.percent}
          done={checklist.done}
          required={checklist.required}
        />
      </div>

      {mode.kind === 'hr' && mode.canUse && (
        <>
          <MultiUpload
            uploadPath={base}
            types={uploadTypes}
            onUploaded={() => {
              setNotice(t('uploaded'));
              router.refresh();
            }}
          />
          {remindableCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3">
              <span className="text-body-sm">{t('remindAllHint', { count: remindableCount })}</span>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void remind(null)}
              >
                {t('remindAll')}
              </button>
            </div>
          )}
        </>
      )}

      {shown.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('noDocuments')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {shown.map((item) => {
            const current = item.documents[0] ?? null;
            const versions = documents.filter((d) => d.typeId === item.type.id && !d.isCurrent);
            const key = item.type.id;
            return (
              <li key={key} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-bold">{name(item.type)}</span>
                    {item.required ? (
                      <span className="rounded-pill bg-surface-raised px-2 text-caption">
                        {t('required')}
                      </span>
                    ) : (
                      <span className="rounded-pill bg-surface-raised px-2 text-caption">
                        {t('optional')}
                      </span>
                    )}
                    {item.type.confidential && (
                      <span className="rounded-pill bg-surface-raised px-2 text-caption">
                        {t('confidential')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StateChip state={item.state} />
                    {mode.kind === 'hr' && mode.canUse && REMINDABLE.includes(item.state) && (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void remind(item.type.id)}
                      >
                        {t('remind')}
                      </button>
                    )}
                    {canUpload && (mode.kind === 'hr' || selfCan(item)) && (
                      <button
                        type="button"
                        className={button}
                        onClick={() =>
                          setTarget({
                            typeId: item.type.id,
                            replacesId: !item.type.multiple ? current?.id : undefined,
                            hasExpiry: item.type.hasExpiry,
                            allowedTypes: item.type.allowedTypes,
                            maxBytes: item.type.maxBytes,
                          })
                        }
                      >
                        {current && !item.type.multiple ? t('newVersion') : t('upload')}
                      </button>
                    )}
                  </div>
                </div>
                {item.documents.map((d) => (
                  <div key={d.id} className="rounded-md bg-surface-raised p-3">
                    {docLine(d, true)}
                  </div>
                ))}
                {versions.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="text-caption font-bold text-link"
                      aria-expanded={!!open[key]}
                      onClick={() => setOpen({ ...open, [key]: !open[key] })}
                    >
                      {t('versions', { count: versions.length })}
                    </button>
                    {open[key] && (
                      <div className="mt-2 space-y-2 border-s-2 border-line ps-3">
                        {versions.map((d) => (
                          <div key={d.id}>{docLine(d, false)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {target?.typeId === item.type.id && (
                  <UploadForm
                    target={target}
                    path={base}
                    onDone={(ok) => {
                      setTarget(null);
                      if (ok) {
                        setNotice(mode.kind === 'self' ? t('sentForReview') : t('uploaded'));
                        router.refresh();
                      }
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {mode.kind === 'hr' && mode.canUse && others.length > 0 && (
        <AddOther
          types={others}
          onPick={(ty) =>
            setTarget({
              typeId: ty.id,
              hasExpiry: ty.hasExpiry,
              allowedTypes: ty.allowedTypes,
              maxBytes: ty.maxBytes,
            })
          }
        />
      )}
      {target && !shown.some((i) => i.type.id === target.typeId) && (
        <UploadForm
          target={target}
          path={base}
          onDone={(ok) => {
            setTarget(null);
            if (ok) {
              setNotice(t('uploaded'));
              router.refresh();
            }
          }}
        />
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

      {rejecting && (
        <RejectDialog
          onCancel={() => setRejecting(null)}
          onConfirm={(note) => void review(rejecting, 'rejected', note)}
          busy={busy}
        />
      )}
      {preview && (
        <Preview
          doc={preview}
          src={`/api${base}/${preview.id}`}
          title={name(preview.type)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function AddOther({
  types,
  onPick,
}: {
  types: DocumentTypeRow[];
  onPick: (t: DocumentTypeRow) => void;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const [id, setId] = useState('');
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-4">
      <label className="block min-w-[220px] flex-1 text-caption">
        {t('addOther')}
        <select value={id} onChange={(e) => setId(e.target.value)} className={field}>
          <option value="">–</option>
          {types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {locale === 'ar' ? ty.nameAr : ty.nameEn}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={button}
        disabled={!id}
        onClick={() => {
          const ty = types.find((x) => x.id === id);
          if (ty) onPick(ty);
        }}
      >
        {t('upload')}
      </button>
    </div>
  );
}

/** Dates and the file: a phone photo (shrunk) or a PDF, for one type. */
function UploadForm({
  target,
  path,
  onDone,
}: {
  target: UploadTarget;
  path: string;
  onDone: (ok: boolean) => void;
}) {
  const t = useTranslations('people');
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const images = target.allowedTypes.filter((x) => x.startsWith('image/'));
  const missingDate = target.hasExpiry && !expiresOn;

  async function send(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (missingDate) return setError(t('errors.expiry_required'));
    setBusy(true);
    let body: Blob = file;
    if (file.type.startsWith('image/')) body = await shrinkPhoto(file, 2000, 0.8).catch(() => file);
    if (body.size > target.maxBytes) {
      setBusy(false);
      return setError(t('errors.document_too_large'));
    }
    const query = new URLSearchParams({ typeId: target.typeId });
    if (target.replacesId) query.set('replacesId', target.replacesId);
    if (title.trim()) query.set('title', title.trim());
    if (issuedOn) query.set('issuedOn', issuedOn);
    if (expiresOn) query.set('expiresOn', expiresOn);
    try {
      const res = await fetch(`/api${path}?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': body.type || 'application/pdf' },
        body,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      if (camera.current) camera.current.value = '';
      if (picker.current) picker.current.value = '';
      if (!res.ok) {
        const code = data.error ?? 'generic';
        return setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      }
      onDone(true);
    } catch {
      setBusy(false);
      setError(t('errors.generic'));
    }
  }

  return (
    <div className="rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-caption">
          {t('docTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('issuedOn')}
          <span className="mt-1 block">
            <DateInput
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
              className={dateBox}
            />
          </span>
        </label>
        <label className="block text-caption">
          {t('expiresOn')}
          {target.hasExpiry && <span className="text-danger"> *</span>}
          <span className="mt-1 block">
            <DateInput
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
              className={dateBox}
            />
          </span>
        </label>
      </div>
      <p className="mt-2 text-caption text-text-muted">
        {t('uploadHint', {
          mb: (target.maxBytes / 1_000_000).toFixed(1),
          formats: target.allowedTypes
            .map((x) => (x === 'application/pdf' ? 'PDF' : x.split('/')[1]!.toUpperCase()))
            .join(', '),
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
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
          accept={target.allowedTypes.join(',')}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void send(e.target.files?.[0])}
        />
        {images.length > 0 && (
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
            disabled={busy || missingDate}
            onClick={() => camera.current?.click()}
          >
            {t('takePhoto')}
          </button>
        )}
        <button
          type="button"
          className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50"
          disabled={busy || missingDate}
          onClick={() => picker.current?.click()}
        >
          {t('chooseFile')}
        </button>
        <button
          type="button"
          className="h-10 rounded-md px-3 text-body-sm font-bold text-link"
          onClick={() => onDone(false)}
        >
          {t('cancel')}
        </button>
      </div>
      {busy && <p className="mt-2 text-body-sm text-text-muted">{t('uploading')}</p>}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function RejectDialog({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: (note: string) => void;
  busy: boolean;
}) {
  const t = useTranslations('people');
  const [note, setNote] = useState('');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('reject')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-shiply-navy/60 p-4"
    >
      <div className="w-full max-w-md space-y-3 rounded-lg bg-surface p-4 shadow-lg">
        <h2 className="text-h3">{t('reject')}</h2>
        <label className="block text-caption">
          {t('rejectNote')}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={300}
            className={`${field} h-auto py-2`}
          />
        </label>
        <p className="text-caption text-text-muted">{t('rejectHint')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={busy || note.trim().length < 2}
            onClick={() => onConfirm(note.trim())}
            className="h-9 rounded-md bg-danger px-4 font-bold text-on-primary disabled:opacity-50"
          >
            {t('reject')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A document shown over the page: photos as an image, PDFs in a frame. */
function Preview({
  doc,
  src,
  title,
  onClose,
}: {
  doc: EmployeeDocument;
  src: string;
  title: string;
  onClose: () => void;
}) {
  const t = useTranslations('people');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-shiply-navy/70 p-3"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line p-3">
          <span className="min-w-0 truncate font-bold">
            {title} · {t('version', { n: doc.version })}
          </span>
          <span className="flex gap-2">
            <a className={button} href={`${src}?download=1`}>
              {t('download')}
            </a>
            <a className={button} href={src} target="_blank" rel="noreferrer">
              {t('openNewTab')}
            </a>
            <button type="button" className={button} onClick={onClose} autoFocus>
              {t('close')}
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-raised">
          {doc.contentType === 'application/pdf' ? (
            <iframe src={src} title={title} className="h-[75vh] w-full border-0" />
          ) : (
            <img src={src} alt={title} className="mx-auto max-h-[75vh] object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}
