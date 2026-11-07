'use client';

import { DOCUMENT_TYPES, TASK_OWNERS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import {
  type ChecklistTemplateRow,
  departmentOptions,
  type DepartmentRow,
  type DocumentTypeRow,
  type PositionRow,
} from '@/lib/hr-types';

// HR configuration (docs/HR.md): document types and checklist templates (departments, positions
// and grades moved to OrganisationSetup in HR phase 1). Everyone with HR view reads them; HR
// manage changes them.

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const small =
  'inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary = 'h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50';

function useSave() {
  const t = useTranslations('people');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(method: 'POST' | 'PATCH', path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok) {
      setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'));
      return false;
    }
    router.refresh();
    return true;
  }
  return { busy, error, send };
}

function Message({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 text-body-sm text-danger">
      {error}
    </p>
  ) : null;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-h3">{title}</h2>
      {children}
    </section>
  );
}

const ActiveChip = ({ active }: { active: boolean }) => {
  const t = useTranslations('people');
  return active ? null : (
    <span className="ms-2 rounded-pill border border-line px-2 text-caption text-text-muted">
      {t('inactive')}
    </span>
  );
};

// ─── document types ──────────────────────────────────────────────────────────

export function DocumentTypesEditor({
  rows,
  departments,
  positions,
  canManage,
}: {
  rows: DocumentTypeRow[];
  departments: DepartmentRow[];
  positions: PositionRow[];
  canManage: boolean;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const save = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const blank = {
    code: '',
    nameEn: '',
    nameAr: '',
    hasExpiry: false,
    required: false,
    requiredEmployment: [] as string[],
    requiredDepartmentIds: [] as string[],
    requiredPositionIds: [] as string[],
    allowedTypes: [...DOCUMENT_TYPES] as string[],
    maxMb: '3',
    confidential: false,
    selfUpload: true,
    multiple: false,
    alertDays: '',
    sort: '0',
    isActive: true,
  };
  const [form, setForm] = useState(blank);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const start = (d: DocumentTypeRow | null) => {
    setEditing(d?.id ?? 'new');
    setForm(
      d
        ? {
            ...d,
            maxMb: String(d.maxBytes / 1_000_000),
            alertDays: d.alertDays == null ? '' : String(d.alertDays),
            sort: String(d.sort),
          }
        : blank,
    );
  };
  async function submit() {
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      hasExpiry: form.hasExpiry,
      required: form.required,
      requiredEmployment: form.requiredEmployment,
      requiredDepartmentIds: form.requiredDepartmentIds,
      requiredPositionIds: form.requiredPositionIds,
      allowedTypes: form.allowedTypes,
      maxBytes: Math.round(Number(form.maxMb) * 1_000_000) || 3_000_000,
      confidential: form.confidential,
      selfUpload: form.selfUpload,
      multiple: form.multiple,
      alertDays: form.alertDays.trim() ? Number(form.alertDays) : null,
      sort: Number(form.sort) || 0,
      isActive: form.isActive,
    };
    const ok =
      editing === 'new'
        ? await save.send('POST', '/hr/document-types', { ...body, code: form.code })
        : await save.send('PATCH', `/hr/document-types/${editing}`, body);
    if (ok) setEditing(null);
  }
  const toggle = (
    key: 'requiredEmployment' | 'requiredDepartmentIds' | 'requiredPositionIds' | 'allowedTypes',
    v: string,
  ) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v],
    }));
  const check = (
    key: 'hasExpiry' | 'required' | 'confidential' | 'selfUpload' | 'multiple' | 'isActive',
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-body-sm">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const editor = (
    <div className="mt-3 space-y-3 rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {editing === 'new' && (
          <label className="block text-caption">
            {t('code')}
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              dir="ltr"
              placeholder="work_permit"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {t('nameEn')}
          <input
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('nameAr')}
          <input
            value={form.nameAr}
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            dir="rtl"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('maxSize')}
          <input
            value={form.maxMb}
            onChange={(e) => setForm({ ...form, maxMb: e.target.value })}
            inputMode="decimal"
            dir="ltr"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('alertDays')}
          <input
            value={form.alertDays}
            onChange={(e) => setForm({ ...form, alertDays: e.target.value })}
            inputMode="numeric"
            dir="ltr"
            placeholder={t('alertDaysHint')}
            className={field}
            disabled={!form.hasExpiry}
          />
        </label>
        <label className="block text-caption">
          {t('order')}
          <input
            value={form.sort}
            onChange={(e) => setForm({ ...form, sort: e.target.value })}
            inputMode="numeric"
            dir="ltr"
            className={field}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {check('hasExpiry', t('hasExpiry'))}
        {check('required', t('requiredToggle'))}
        {check('confidential', t('confidentialToggle'))}
        {check('selfUpload', t('selfUploadToggle'))}
        {check('multiple', t('multipleToggle'))}
        {check('isActive', t('active'))}
      </div>
      <fieldset>
        <legend className="text-caption font-bold">{t('formats')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
          {DOCUMENT_TYPES.map((x) => (
            <label key={x} className="flex items-center gap-2 text-body-sm">
              <input
                type="checkbox"
                checked={form.allowedTypes.includes(x)}
                onChange={() => toggle('allowedTypes', x)}
              />
              {x === 'application/pdf' ? 'PDF' : x.split('/')[1]!.toUpperCase()}
            </label>
          ))}
        </div>
      </fieldset>
      {form.required && (
        <fieldset className="rounded-md bg-surface-raised p-3">
          <legend className="text-caption font-bold">{t('requiredFor')}</legend>
          <p className="text-caption text-text-muted">{t('requiredForHint')}</p>
          <p className="mt-2 text-caption font-bold">{t('employment')}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {(['employee', 'outsourced'] as const).map((x) => (
              <label key={x} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.requiredEmployment.includes(x)}
                  onChange={() => toggle('requiredEmployment', x)}
                />
                {t(`employments.${x}`)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-caption font-bold">{t('departmentsRule')}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {departmentOptions(departments).map(({ d }) => (
              <label key={d.id} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={form.requiredDepartmentIds.includes(d.id)}
                  onChange={() => toggle('requiredDepartmentIds', d.id)}
                />
                {name(d)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-caption font-bold">{t('positionsRule')}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {positions
              .filter((p) => p.isActive)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={form.requiredPositionIds.includes(p.id)}
                    onChange={() => toggle('requiredPositionIds', p.id)}
                  />
                  {locale === 'ar' ? p.titleAr : p.titleEn}
                </label>
              ))}
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={save.busy || form.allowedTypes.length === 0}
          onClick={() => void submit()}
        >
          {t('save')}
        </button>
        <button type="button" className={small} onClick={() => setEditing(null)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
  const rule = (d: DocumentTypeRow) => {
    if (!d.required) return t('optionalType');
    const parts = [
      ...d.requiredEmployment.map((x) => t(`employments.${x}`)),
      ...d.requiredDepartmentIds.map((id) => {
        const dep = departments.find((x) => x.id === id);
        return dep ? name(dep) : id;
      }),
      ...d.requiredPositionIds.map((id) => {
        const p = positions.find((x) => x.id === id);
        return p ? (locale === 'ar' ? p.titleAr : p.titleEn) : id;
      }),
    ];
    return parts.length ? t('requiredOnly', { who: parts.join(', ') }) : t('requiredEveryone');
  };
  return (
    <Panel title={t('documentTypesTitle')}>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addDocumentType')}
        </button>
      )}
      {editing === 'new' && editor}
      <Message error={save.error} />
      <ul className="mt-3 divide-y divide-line rounded-md border border-line">
        {rows.map((d) => (
          <li key={d.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-bold">{name(d)}</span>
                <span className="ltr-iso ms-2 text-caption text-text-muted">{d.code}</span>
                <ActiveChip active={d.isActive} />
                <span className="block text-caption text-text-muted">
                  {rule(d)}
                  {d.hasExpiry && <> · {t('hasExpiry')}</>}
                  {d.confidential && <> · {t('confidential')}</>}
                  {d.multiple && <> · {t('multipleToggle')}</>}
                  {!d.selfUpload && <> · {t('hrOnly')}</>}
                  {' · '}
                  <span className="ltr-iso">
                    {d.allowedTypes
                      .map((x) =>
                        x === 'application/pdf' ? 'PDF' : x.split('/')[1]!.toUpperCase(),
                      )
                      .join('/')}{' '}
                    ≤ {(d.maxBytes / 1_000_000).toFixed(1)} MB
                  </span>
                </span>
              </span>
              {canManage && editing !== d.id && (
                <button type="button" className={small} onClick={() => start(d)}>
                  {t('edit')}
                </button>
              )}
            </div>
            {editing === d.id && editor}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── checklist templates ─────────────────────────────────────────────────────

interface TaskForm {
  titleEn: string;
  titleAr: string;
  ownerRole: string;
  dueDays: string;
  documentTypeId: string;
}

export function TemplatesEditor({
  rows,
  positions,
  types,
  canManage,
}: {
  rows: ChecklistTemplateRow[];
  positions: PositionRow[];
  types: DocumentTypeRow[];
  canManage: boolean;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const save = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const blankTask = (): TaskForm => ({
    titleEn: '',
    titleAr: '',
    ownerRole: 'hr',
    dueDays: '0',
    documentTypeId: '',
  });
  const blank = {
    code: '',
    kind: 'onboarding',
    nameEn: '',
    nameAr: '',
    positionId: '',
    isActive: true,
    tasks: [blankTask()],
  };
  const [form, setForm] = useState(blank);
  const start = (x: ChecklistTemplateRow | null) => {
    setEditing(x?.id ?? 'new');
    setForm(
      x
        ? {
            code: x.code,
            kind: x.kind,
            nameEn: x.nameEn,
            nameAr: x.nameAr,
            positionId: x.positionId ?? '',
            isActive: x.isActive,
            tasks: x.tasks.map((k) => ({
              ...k,
              dueDays: String(k.dueDays),
              documentTypeId: k.documentTypeId ?? '',
            })),
          }
        : blank,
    );
  };
  async function submit() {
    const body = {
      kind: form.kind,
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      positionId: form.positionId || null,
      isActive: form.isActive,
      tasks: form.tasks.map((k) => ({
        titleEn: k.titleEn,
        titleAr: k.titleAr,
        ownerRole: k.ownerRole,
        dueDays: Number(k.dueDays) || 0,
        documentTypeId: k.documentTypeId || null,
      })),
    };
    const ok =
      editing === 'new'
        ? await save.send('POST', '/hr/checklist-templates', { ...body, code: form.code })
        : await save.send('PATCH', `/hr/checklist-templates/${editing}`, body);
    if (ok) setEditing(null);
  }
  const setTask = (i: number, patch: Partial<TaskForm>) =>
    setForm((f) => ({ ...f, tasks: f.tasks.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const editor = (
    <div className="mt-3 space-y-3 rounded-md border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {editing === 'new' && (
          <label className="block text-caption">
            {t('code')}
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              dir="ltr"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {t('kind')}
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className={field}
          >
            <option value="onboarding">{t('checklistKinds.onboarding')}</option>
            <option value="offboarding">{t('checklistKinds.offboarding')}</option>
          </select>
        </label>
        <label className="block text-caption">
          {t('nameEn')}
          <input
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('nameAr')}
          <input
            value={form.nameAr}
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            dir="rtl"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {t('forPosition')}
          <select
            value={form.positionId}
            onChange={(e) => setForm({ ...form, positionId: e.target.value })}
            className={field}
          >
            <option value="">{t('anyPosition')}</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {locale === 'ar' ? p.titleAr : p.titleEn}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ol className="space-y-2">
        {form.tasks.map((k, i) => (
          <li
            key={i}
            className="grid gap-2 rounded-md bg-surface-raised p-2 sm:grid-cols-[1fr_1fr_8rem_6rem_1fr_auto]"
          >
            <input
              value={k.titleEn}
              onChange={(e) => setTask(i, { titleEn: e.target.value })}
              placeholder={t('titleEn')}
              aria-label={t('titleEn')}
              className={field}
            />
            <input
              value={k.titleAr}
              onChange={(e) => setTask(i, { titleAr: e.target.value })}
              placeholder={t('titleAr')}
              aria-label={t('titleAr')}
              dir="rtl"
              className={field}
            />
            <select
              value={k.ownerRole}
              onChange={(e) => setTask(i, { ownerRole: e.target.value })}
              aria-label={t('owner')}
              className={field}
            >
              {TASK_OWNERS.map((o) => (
                <option key={o} value={o}>
                  {t(`owners.${o}`)}
                </option>
              ))}
            </select>
            <input
              value={k.dueDays}
              onChange={(e) => setTask(i, { dueDays: e.target.value })}
              inputMode="numeric"
              dir="ltr"
              aria-label={t('dueDays')}
              title={t('dueDays')}
              className={field}
            />
            <select
              value={k.documentTypeId}
              onChange={(e) => setTask(i, { documentTypeId: e.target.value })}
              aria-label={t('linkedDocument')}
              className={field}
            >
              <option value="">{t('noLinkedDocument')}</option>
              {types.map((d) => (
                <option key={d.id} value={d.id}>
                  {locale === 'ar' ? d.nameAr : d.nameEn}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${small} mt-1 text-danger`}
              aria-label={t('removeTask')}
              onClick={() => setForm({ ...form, tasks: form.tasks.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <p className="text-caption text-text-muted">{t('dueDaysHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={small}
          onClick={() => setForm({ ...form, tasks: [...form.tasks, blankTask()] })}
        >
          + {t('addTask')}
        </button>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          {t('active')}
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={primary}
          disabled={save.busy || form.tasks.length === 0}
          onClick={() => void submit()}
        >
          {t('save')}
        </button>
        <button type="button" className={small} onClick={() => setEditing(null)}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
  return (
    <Panel title={t('templatesTitle')}>
      <p className="mt-1 text-caption text-text-muted">{t('templatesHint')}</p>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addTemplate')}
        </button>
      )}
      {editing === 'new' && editor}
      <Message error={save.error} />
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {rows.map((x) => (
          <article key={x.id} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-bold">{locale === 'ar' ? x.nameAr : x.nameEn}</span>
                <ActiveChip active={x.isActive} />
                <span className="block text-caption text-text-muted">
                  {t(`checklistKinds.${x.kind}`)} ·{' '}
                  {x.position
                    ? locale === 'ar'
                      ? x.position.titleAr
                      : x.position.titleEn
                    : t('anyPosition')}
                </span>
              </span>
              {canManage && editing !== x.id && (
                <button type="button" className={small} onClick={() => start(x)}>
                  {t('edit')}
                </button>
              )}
            </div>
            {editing === x.id ? (
              editor
            ) : (
              <ol className="mt-2 list-decimal space-y-1 ps-5 text-body-sm">
                {x.tasks.map((k) => (
                  <li key={k.id}>
                    {locale === 'ar' ? k.titleAr : k.titleEn}{' '}
                    <span className="text-caption text-text-muted">
                      · {t(`owners.${k.ownerRole}`)} · {t('dayN', { n: k.dueDays })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}
