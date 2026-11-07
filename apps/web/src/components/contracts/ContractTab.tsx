'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import { type ContractVersion, type ContractView, shownVersion } from '@/lib/contracts';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime } from '@/lib/format';
import { ContractCalculator } from './ContractCalculator';
import { ContractDocument, ContractStanding, VersionPill } from './ContractDocument';
import { ContractEditor } from './ContractEditor';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-body-sm';
const primary =
  'inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';

const ACTIVATE_ERRORS = [
  'effective_before_today',
  'effective_before_last_version',
  'books_closed',
  'effective_after_end',
  'contract_version_not_draft',
];
const FILE_ERRORS = ['file_type_not_allowed', 'file_too_large'];

/** Links to the printed contract in English and Arabic. */
export function PrintLinks({ href, version }: { href: string; version?: string }) {
  const t = useTranslations('contracts');
  const q = version ? `&version=${version}` : '';
  return (
    <span className="flex flex-wrap gap-2">
      <a className="btn-secondary inline-flex h-10 items-center" href={`${href}?lang=en${q}`}>
        {t('printEn')}
      </a>
      <a className="btn-secondary inline-flex h-10 items-center" href={`${href}?lang=ar${q}`}>
        {t('printAr')}
      </a>
    </span>
  );
}

/** The draft waiting: what it changes, activate from a day, or throw it away. */
function DraftPanel({
  view,
  draft,
  today,
  onEdit,
}: {
  view: ContractView;
  draft: ContractVersion;
  today: string;
  onEdit: () => void;
}) {
  const t = useTranslations('contracts');
  const router = useRouter();
  const [day, setDay] = useState(
    draft.effectiveFrom && draft.effectiveFrom > today ? draft.effectiveFrom : today,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/admin/merchants/${view.merchant.id}/contract/versions/${draft.id}`;
  async function activate() {
    if (!window.confirm(t('draft.confirmActivate', { day: isoToDayFirst(day) }))) return;
    setBusy(true);
    setError(null);
    const r = await apiSend('POST', `${base}/activate`, { effectiveFrom: day });
    setBusy(false);
    if (!r.ok)
      return setError(t(`errors.${ACTIVATE_ERRORS.includes(r.error) ? r.error : 'generic'}`));
    router.refresh();
  }
  async function remove() {
    if (!window.confirm(t('draft.confirmDelete'))) return;
    setBusy(true);
    const r = await apiSend('DELETE', base);
    setBusy(false);
    if (!r.ok) return setError(t('errors.generic'));
    router.refresh();
  }
  return (
    <section className="space-y-3 rounded-lg border-s-4 border-status-needs-action bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-bold">{t('draft.title', { label: draft.label })}</h3>
        <VersionPill status="draft" />
      </div>
      <p className="text-body-sm text-text-muted">{t('draft.intro')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-caption">
          {t('draft.activateOn')}
          <DateInput
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className={`${field} mt-1`}
          />
        </label>
        <button type="button" className={primary} disabled={busy} onClick={() => void activate()}>
          {t('draft.activate')}
        </button>
        <button type="button" className="btn-secondary h-10" onClick={onEdit}>
          {t('draft.edit')}
        </button>
        <button
          type="button"
          className="btn-secondary h-10"
          disabled={busy}
          onClick={() => void remove()}
        >
          {t('draft.delete')}
        </button>
      </div>
      <p className="text-caption text-text-muted">{t('draft.activateHint')}</p>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-body-sm font-bold text-link">
          {t('draft.preview')}
        </summary>
        <div className="mt-3">
          <ContractDocument view={view} version={draft} internal />
        </div>
      </details>
    </section>
  );
}

/** Every version, newest first, each printable and viewable read only. */
export function VersionHistory({
  view,
  hrefBase,
  pdfHref,
  selectedId,
  internal,
}: {
  view: ContractView;
  /** The address a version opens at, the version's id appended */
  hrefBase: string;
  pdfHref: string;
  selectedId?: string | null;
  internal: boolean;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const list = view.versions.filter((v) => v.status !== 'draft');
  return (
    <section
      className="space-y-2 rounded-lg border border-line bg-surface p-4"
      aria-label={t('versions.title')}
    >
      <h3 className="text-body font-bold">{t('versions.title')}</h3>
      {list.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('versions.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-body-sm font-bold">
                  {v.label} <VersionPill status={v.displayStatus} />
                </p>
                <p className="text-caption text-text-muted">
                  {v.effectiveFrom && t('effectiveFrom', { day: isoToDayFirst(v.effectiveFrom) })}
                  {internal && v.activatedAt && (
                    <>
                      {' · '}
                      {t('versions.activated', {
                        name: v.activatedBy ?? t('versions.system'),
                        time: formatCairoDateTime(v.activatedAt, locale),
                      })}
                    </>
                  )}
                  {internal && v.source && (
                    <>
                      {' · '}
                      {v.source === 'migration'
                        ? t('versions.fromMigration')
                        : t('versions.fromProposal', { number: v.source })}
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedId !== v.id && (
                  <Link
                    className="btn-secondary inline-flex h-10 items-center"
                    href={`${hrefBase}${v.id}`}
                  >
                    {t('versions.view')}
                  </Link>
                )}
                <PrintLinks href={pdfHref} version={v.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Signed copies of the contract: open, attach (PDF, JPG or PNG, 5 MB), remove. */
function FilesPanel({ view, canManage }: { view: ContractView; canManage: boolean }) {
  const t = useTranslations('contracts.files');
  const tc = useTranslations('contracts');
  const locale = useLocale();
  const router = useRouter();
  const [versionId, setVersionId] = useState(view.current?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/admin/merchants/${view.merchant.id}/contract/files`;
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError(tc('errors.file_too_large'));
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({ name: file.name });
    if (versionId) q.set('versionId', versionId);
    const res = await fetch(`${base}?${q.toString()}`, {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? '';
      return setError(tc(`errors.${FILE_ERRORS.includes(code) ? code : 'generic'}`));
    }
    router.refresh();
  }
  async function remove(id: string) {
    if (!window.confirm(t('confirmRemove'))) return;
    const r = await apiSend('DELETE', `/admin/merchants/${view.merchant.id}/contract/files/${id}`);
    if (!r.ok) return setError(tc('errors.generic'));
    router.refresh();
  }
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-body font-bold">{t('title')}</h3>
      {view.files.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {view.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <a
                  className="break-all text-body-sm font-bold text-link"
                  href={`${base}/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {f.fileName}
                </a>
                <p className="text-caption text-text-muted">
                  {f.version ? t('signs', { version: f.version }) : t('whole')} ·{' '}
                  <span className="ltr-iso">{Math.ceil(f.sizeBytes / 1024)} KB</span> ·{' '}
                  {formatCairoDateTime(f.createdAt, locale)}
                  {f.uploadedBy && ` · ${f.uploadedBy}`}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className="btn-secondary h-10"
                  onClick={() => void remove(f.id)}
                >
                  {t('remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && view.contract && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <label className="block text-caption">
            {t('version')}
            <select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className={`${field} mt-1`}
            >
              <option value="">{t('whole')}</option>
              {view.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${primary} cursor-pointer ${busy ? 'opacity-50' : ''}`}>
            {t('upload')}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              disabled={busy}
              onChange={(e) => void upload(e)}
            />
          </label>
          <p className="w-full text-caption text-text-muted">{t('hint')}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** The payout bank account inside the contract's payment terms (merchants manage edits). */
function BankEditor({ view }: { view: ContractView }) {
  const t = useTranslations('contracts');
  const router = useRouter();
  const b = view.merchant.bank;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    bankName: b.bankName ?? '',
    bankAccountNumber: b.bankAccountNumber ?? '',
    iban: b.iban ?? '',
    beneficiaryName: b.beneficiaryName ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const shown =
    b.iban || b.bankAccountNumber ? (
      <span className="break-words">
        {[b.bankName, b.beneficiaryName].filter(Boolean).join(' · ')}
        <span className="ltr-iso block">{b.iban ?? b.bankAccountNumber}</span>
      </span>
    ) : (
      t('noBank')
    );
  if (!open)
    return (
      <span className="flex flex-wrap items-center gap-2">
        {shown}
        <button
          type="button"
          className="text-body-sm font-bold text-link"
          onClick={() => setOpen(true)}
        >
          {t('bankEdit')}
        </button>
      </span>
    );
  async function save() {
    const r = await apiSend('PUT', `/admin/merchants/${view.merchant.id}/bank`, {
      bankName: form.bankName.trim() || null,
      bankAccountNumber: form.bankAccountNumber.trim() || null,
      iban: form.iban.trim().toUpperCase() || null,
      beneficiaryName: form.beneficiaryName.trim() || null,
    });
    if (!r.ok)
      return setError(t(`errors.${r.error === 'invalid_iban' ? 'invalid_iban' : 'generic'}`));
    setOpen(false);
    router.refresh();
  }
  return (
    <span className="grid gap-2 font-normal">
      {(
        [
          ['bankName', t('bankName')],
          ['beneficiaryName', t('beneficiary')],
          ['bankAccountNumber', t('accountNumber')],
          ['iban', t('iban')],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="block text-caption">
          {label}
          <input
            dir={k === 'bankName' || k === 'beneficiaryName' ? undefined : 'ltr'}
            value={form[k]}
            onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            className={`${field} mt-1`}
          />
        </label>
      ))}
      <span className="flex gap-2">
        <button type="button" className={primary} onClick={() => void save()}>
          {t('bankSave')}
        </button>
        <button type="button" className="btn-secondary h-10" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
      </span>
      {error && (
        <span role="alert" className="text-body-sm text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * The Contract tab of a merchant's page: the version in force as a document (or the version
 * picked from the history), the calculator, Edit (a new draft), the draft to activate, the
 * history, signed copies and the printed contract in English and Arabic.
 */
export function ContractTab({
  view,
  canManage,
  today,
  selectedVersionId,
}: {
  view: ContractView;
  canManage: boolean;
  today: string;
  selectedVersionId?: string | null;
}) {
  const t = useTranslations('contracts');
  const [editing, setEditing] = useState(false);
  const shown = shownVersion(view, selectedVersionId);
  const pdfHref = `/api/admin/merchants/${view.merchant.id}/contract/pdf`;
  const tabHref = `/admin/merchants/${view.merchant.id}?tab=contract`;
  if (editing)
    return (
      <ContractEditor
        view={view}
        base={view.draft ?? view.scheduled[view.scheduled.length - 1] ?? view.current}
        today={today}
        onDone={() => setEditing(false)}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-h3">{view.contract?.label ?? t('title')}</h2>
          {selectedVersionId && shown && (
            <Link href={tabHref} className="text-body-sm text-link">
              {t('backToCurrent')}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && !view.draft && (
            <button type="button" className={primary} onClick={() => setEditing(true)}>
              {view.contract ? t('edit') : t('create')}
            </button>
          )}
          {shown && (
            <PrintLinks href={pdfHref} version={selectedVersionId ? shown.id : undefined} />
          )}
        </div>
      </div>

      {canManage && view.draft && (
        <DraftPanel view={view} draft={view.draft} today={today} onEdit={() => setEditing(true)} />
      )}

      {view.scheduled.length > 0 && !selectedVersionId && (
        <p className="rounded-lg border border-line bg-surface p-3 text-body-sm">
          {t('scheduledNote', {
            label: view.scheduled[0]!.label,
            day: isoToDayFirst(view.scheduled[0]!.effectiveFrom!),
          })}{' '}
          <Link
            href={`${tabHref}&version=${view.scheduled[0]!.id}`}
            className="font-bold text-link"
          >
            {t('versions.view')}
          </Link>
        </p>
      )}

      {shown ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ContractDocument
            view={view}
            version={shown}
            internal
            csvBase={`/api/admin/merchants/${view.merchant.id}`}
            bankSlot={
              canManage && shown.id === view.current?.id ? <BankEditor view={view} /> : undefined
            }
          />
          <div className="space-y-4">
            <ContractStanding view={view} internal />
            <ContractCalculator version={shown} view={view} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg border border-dashed border-line bg-surface p-4 text-body-sm">
            {t('noContract')}
          </p>
          <ContractCalculator version={null} view={view} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <VersionHistory
          view={view}
          hrefBase={`${tabHref}&version=`}
          pdfHref={pdfHref}
          selectedId={selectedVersionId}
          internal
        />
        <FilesPanel view={view} canManage={canManage} />
      </div>
    </div>
  );
}
