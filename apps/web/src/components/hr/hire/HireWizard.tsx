'use client';

import {
  ACCESS_APPS,
  ALLOWANCE_KINDS,
  type AllowanceKind,
  defaultHireAccess,
  hireAccessValues,
  type HireDraftData,
  hireProgress,
  type HireStep,
  hireStepIssues,
  hirePayBasis,
  hireSteps,
  JOB_ROLES,
  type JobRole,
  nextHireStep,
  normalizeEgyptianPhone,
  probationEnd,
  type StepIssues,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { MultiUpload } from '@/components/hr/MultiUpload';
import { PhotoEditor } from '@/components/hr/PhotoEditor';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type { ShiftRow } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import {
  egpText,
  gradesFor,
  headOfChain,
  type HireDraft,
  type HireResult,
  type RequiredDocType,
  setupLink,
  stepOfField,
} from '@/lib/hr-phase2';
import {
  departmentOptions,
  type DepartmentRow,
  type DocumentTypeRow,
  type EmployeeRow,
  type GradeRow,
  type PositionRow,
} from '@/lib/hr-types';
import { parseEgp } from '@/lib/money';

const box =
  'mt-1 block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
const dateBox = 'h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
const primary =
  'inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-body-sm font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'inline-flex h-11 items-center justify-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-text hover:bg-surface-raised disabled:opacity-50';

export interface HireLookups {
  stores: AdminStore[];
  departments: DepartmentRow[];
  positions: PositionRow[];
  grades: GradeRow[];
  suppliers: { id: string; name: string; isRiderOffice?: boolean }[];
  shifts: ShiftRow[];
  people: EmployeeRow[];
  documentTypes: DocumentTypeRow[];
}

export interface HireGrant {
  canPay: boolean;
  settings: boolean;
  salaries: boolean;
  customerData: boolean;
  allStores: boolean;
  storeIds: string[];
}

const empty: HireDraftData = { person: {}, job: {}, pay: {}, access: {} };

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `hire-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A box with its label, an optional hint and the step's issue under it. */
function Field({
  label,
  error,
  hint,
  required,
  children,
  wide,
}: {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="block text-caption font-bold">
        {label}
        {required && <span className="text-danger"> *</span>}
        {children}
      </label>
      {hint && <p className="mt-1 text-caption text-text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-caption font-bold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** EGP typed by a person, kept as integer piastres (never a float). */
function MoneyBox({
  value,
  onChange,
  label,
}: {
  value: number | null | undefined;
  onChange: (piastres: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState(egpText(value));
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseEgp(e.target.value));
      }}
      className={`${box} ltr-iso`}
    />
  );
}

/**
 * The new hire wizard (HR phase 2): one guided form in steps (person, job, pay with the
 * salaries switch, documents, system access, review) with a progress bar, Back and Next. Each
 * Next saves the draft, so HR can stop and come back from the HR home. Create makes the person
 * in one go and shows the one time setup link.
 */
export function HireWizard({
  draft,
  initialStep,
  lookups,
  grant,
  probationMonths,
  today,
}: {
  draft: HireDraft | null;
  initialStep: HireStep;
  lookups: HireLookups;
  grant: HireGrant;
  probationMonths: number;
  today: string;
}) {
  const t = useTranslations('hr2');
  const tu = useTranslations('admin.users');
  const th = useTranslations('hr');
  const tp = useTranslations('people');
  const tr = useTranslations('riderPay');
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<HireDraftData>(draft?.data ?? empty);
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [step, setStep] = useState<HireStep>(initialStep);
  const [issues, setIssues] = useState<StepIssues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [result, setResult] = useState<HireResult | null>(null);
  const [files, setFiles] = useState(draft?.files ?? []);
  const [required, setRequired] = useState<RequiredDocType[] | null>(null);
  const createKey = useRef(newKey());
  const top = useRef<HTMLDivElement>(null);

  const steps = hireSteps({
    canPay: grant.canPay,
    employment: data.job.employment,
    payBasis: hirePayBasis(data.job),
  });
  const at = Math.max(0, steps.indexOf(step));
  const progress = hireProgress(steps, step);
  const p = data.person;
  const j = data.job;
  const a = data.access;
  const name = (x: { nameEn: string; nameAr: string | null }) =>
    locale === 'ar' && x.nameAr ? x.nameAr : x.nameEn;
  const issue = (key: string) => (issues[key] ? t(`issues.${issues[key]}`) : null);
  const position = lookups.positions.find((x) => x.id === j.positionId);
  const head = headOfChain(lookups.departments, j.departmentId || position?.departmentId);
  const myStores = grant.allStores
    ? lookups.stores
    : lookups.stores.filter((s) => grant.storeIds.includes(s.id));

  const setPerson = (patch: Partial<HireDraftData['person']>) =>
    setData((d) => ({ ...d, person: { ...d.person, ...patch } }));
  const setJob = (patch: Partial<HireDraftData['job']>) =>
    setData((d) => ({ ...d, job: { ...d.job, ...patch } }));
  const setPay = (patch: Partial<HireDraftData['pay']>) =>
    setData((d) => ({ ...d, pay: { ...d.pay, ...patch } }));
  const setAccess = (patch: Partial<HireDraftData['access']>) =>
    setData((d) => ({ ...d, access: { ...d.access, ...patch } }));

  const fail = (code: string) =>
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  /** Saves the draft at a step (the first save starts it and moves to its address). */
  async function persist(at: HireStep, body: HireDraftData = data) {
    setBusy(true);
    setError(null);
    const payload = { step: at, data: grant.canPay ? body : { ...body, pay: {} } };
    const result = draftId
      ? await apiSend<HireDraft>('PUT', `/hr/hire-drafts/${draftId}`, payload)
      : await apiSend<HireDraft>('POST', '/hr/hire-drafts', payload);
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return null;
    }
    setSaved(t('savedAt'));
    if (!draftId) {
      setDraftId(result.data.id);
      router.replace(`/admin/hr/hire/${result.data.id}?step=${at}`, { scroll: false });
    } else window.history.replaceState(null, '', `/admin/hr/hire/${draftId}?step=${at}`);
    return result.data;
  }

  function show(next: HireStep) {
    setStep(next);
    setIssues({});
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function goNext() {
    const found = hireStepIssues(data, step, { today, steps });
    if (Object.keys(found).length > 0) {
      setIssues(found);
      return;
    }
    let next = nextHireStep(steps, step, 1);
    let body = data;
    // The access step starts from the position's job role and the job's stores.
    if (next === 'access' && a.login === undefined) {
      body = {
        ...data,
        access: defaultHireAccess({
          kind: j.kind,
          positionCode: position?.code ?? null,
          storeIds: j.storeIds ?? [],
        }),
      };
      setData(body);
    }
    if (next === 'pay' && !steps.includes('pay')) next = nextHireStep(steps, next, 1);
    if (await persist(next, body)) show(next);
  }

  async function goBack() {
    const prev = nextHireStep(steps, step, -1);
    if (await persist(prev)) show(prev);
  }

  async function jump(to: HireStep) {
    if (await persist(to)) show(to);
  }

  async function saveAndClose() {
    if (await persist(step)) router.push('/admin/hr/overview');
  }

  async function discard() {
    if (!draftId) return router.push('/admin/hr/overview');
    if (!window.confirm(t('discardConfirm'))) return;
    setBusy(true);
    const res = await apiSend('DELETE', `/hr/hire-drafts/${draftId}`);
    setBusy(false);
    if (!res.ok) return fail(res.error);
    router.push('/admin/hr/overview');
  }

  async function create() {
    const found = hireStepIssues(data, 'review', { today, steps });
    if (Object.keys(found).length > 0) {
      setIssues(found);
      return;
    }
    if (!(await persist('review'))) return;
    setBusy(true);
    const res = await apiSend<HireResult>('POST', `/hr/hire-drafts/${draftId}/create`, {
      idempotencyKey: createKey.current,
    });
    setBusy(false);
    if (!res.ok) return fail(res.error);
    setResult(res.data);
  }

  // The documents step reads which types this placement needs.
  useEffect(() => {
    if (step !== 'documents' || !draftId) return;
    let live = true;
    void apiGetClient<RequiredDocType[]>(`/hr/hire-drafts/${draftId}/required-documents`).then(
      (r) => {
        if (live && r.ok) setRequired(r.data);
      },
    );
    return () => {
      live = false;
    };
  }, [step, draftId]);

  async function reloadFiles() {
    if (!draftId) return;
    const r = await apiGetClient<HireDraft>(`/hr/hire-drafts/${draftId}`);
    if (r.ok) setFiles(r.data.files);
  }

  async function removeFile(id: string) {
    const r = await apiSend('DELETE', `/hr/hire-drafts/${draftId}/files/${id}`);
    if (!r.ok) return fail(r.error);
    await reloadFiles();
  }

  if (result) return <Done result={result} name={p.nameEn ?? ''} />;

  const defaultProbation = j.hireDate
    ? probationEnd({ probationEndsOn: null, hireDate: j.hireDate, months: probationMonths })
    : null;
  const allowances = data.pay.allowances ?? [];
  const gross =
    (data.pay.basicPiastres ?? 0) + allowances.reduce((s, x) => s + (x.amountPiastres || 0), 0);
  const login = j.kind === 'rider' || Boolean(a.login);
  const template = a.jobRole ? hireAccessValues(a) : null;

  return (
    <div ref={top} className="mt-4 max-w-4xl scroll-mt-20">
      {/* Progress: the steps with the one open, and a bar. */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-caption text-text-muted">
          {t('stepOf', { n: at + 1, total: steps.length })}
          {' · '}
          <span className="font-bold text-text">{t(`steps.${step}`)}</span>
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-raised"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('progress')}
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
          {steps.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                disabled={busy || i > at}
                onClick={() => void jump(s)}
                aria-current={s === step ? 'step' : undefined}
                className={`inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-caption font-bold ${
                  s === step
                    ? 'border-primary bg-primary text-on-primary'
                    : i < at
                      ? 'border-line text-link'
                      : 'border-line text-text-muted'
                }`}
              >
                <span className="ltr-iso">{i + 1}</span>
                <span>{t(`steps.${s}`)}</span>
              </button>
            </li>
          ))}
        </ol>
        {!grant.canPay && <p className="mt-2 text-caption text-text-muted">{t('payByManager')}</p>}
      </div>

      <section
        className="mt-4 rounded-lg border border-line bg-surface p-4"
        aria-labelledby="step-title"
      >
        <h2 id="step-title" className="text-h3">
          {t(`steps.${step}`)}
        </h2>
        <p className="mt-1 text-body-sm text-text-muted">{t(`intros.${step}`)}</p>

        {step === 'person' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-4 sm:col-span-2">
              {draftId ? (
                <PhotoEditor
                  employeeId={draftId}
                  photoVersion={draft?.photoVersion ?? null}
                  name={p.nameEn || '?'}
                  uploadPath={`/hr/hire-drafts/${draftId}/photo`}
                  src={
                    draft?.photoVersion
                      ? `/api/hr/hire-drafts/${draftId}/photo?v=${draft.photoVersion}`
                      : null
                  }
                />
              ) : (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy || !p.nameEn}
                  onClick={() => void persist('person')}
                >
                  {t('person.addPhoto')}
                </button>
              )}
              <p className="text-caption text-text-muted">{t('person.photoHint')}</p>
            </div>
            <Field label={th('fields.nameEn')} required error={issue('person.nameEn')}>
              <input
                value={p.nameEn ?? ''}
                onChange={(e) => setPerson({ nameEn: e.target.value })}
                maxLength={120}
                autoComplete="off"
                className={box}
              />
            </Field>
            <Field label={th('fields.nameAr')} error={issue('person.nameAr')}>
              <input
                dir="rtl"
                value={p.nameAr ?? ''}
                onChange={(e) => setPerson({ nameAr: e.target.value })}
                maxLength={120}
                className={box}
              />
            </Field>
            <Field
              label={th('fields.mobile')}
              required
              error={issue('person.mobile')}
              hint={
                p.mobile && normalizeEgyptianPhone(p.mobile) ? (
                  <span className="ltr-iso">{normalizeEgyptianPhone(p.mobile)}</span>
                ) : (
                  t('person.mobileHint')
                )
              }
            >
              <input
                inputMode="tel"
                value={p.mobile ?? ''}
                onChange={(e) => setPerson({ mobile: e.target.value })}
                maxLength={30}
                className={`${box} ltr-iso`}
              />
            </Field>
            <Field label={tp('email')} error={issue('person.email')} hint={t('person.emailHint')}>
              <input
                type="email"
                value={p.email ?? ''}
                onChange={(e) => setPerson({ email: e.target.value })}
                maxLength={200}
                className={`${box} ltr-iso`}
              />
            </Field>
            <Field label={th('fields.nationalId')} error={issue('person.nationalId')}>
              <input
                inputMode="numeric"
                value={p.nationalId ?? ''}
                onChange={(e) => setPerson({ nationalId: e.target.value })}
                maxLength={14}
                className={`${box} ltr-iso`}
              />
            </Field>
            <Field label={th('fields.birthDate')} error={issue('person.birthDate')}>
              <span className="mt-1 block">
                <DateInput
                  value={p.birthDate ?? ''}
                  onChange={(e) => setPerson({ birthDate: e.target.value })}
                  className={dateBox}
                />
              </span>
            </Field>
            <Field label={th('fields.address')} wide>
              <input
                value={p.address ?? ''}
                onChange={(e) => setPerson({ address: e.target.value })}
                maxLength={300}
                className={box}
              />
            </Field>
            <Field label={th('fields.emergencyName')}>
              <input
                value={p.emergencyName ?? ''}
                onChange={(e) => setPerson({ emergencyName: e.target.value })}
                maxLength={120}
                className={box}
              />
            </Field>
            <Field label={th('fields.emergencyPhone')} error={issue('person.emergencyPhone')}>
              <input
                inputMode="tel"
                value={p.emergencyPhone ?? ''}
                onChange={(e) => setPerson({ emergencyPhone: e.target.value })}
                maxLength={30}
                className={`${box} ltr-iso`}
              />
            </Field>
          </div>
        )}

        {step === 'job' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <fieldset className="sm:col-span-2">
              <legend className="text-caption font-bold">
                {t('job.kind')} <span className="text-danger">*</span>
              </legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(['team', 'rider'] as const).map((k) => (
                  <label
                    key={k}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
                      j.kind === k ? 'border-primary' : 'border-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      checked={j.kind === k}
                      onChange={() => {
                        const rider = lookups.positions.find((x) => x.code === 'RIDER');
                        setJob({
                          kind: k,
                          ...(k === 'rider' && !j.positionId && rider
                            ? { positionId: rider.id, departmentId: rider.departmentId }
                            : {}),
                          ...(k === 'rider' && (j.storeIds?.length ?? 0) > 1
                            ? { storeIds: j.storeIds!.slice(0, 1) }
                            : {}),
                        });
                      }}
                    />
                    <span>
                      <span className="block font-bold">{t(`job.kinds.${k}`)}</span>
                      <span className="block text-caption text-text-muted">
                        {t(`job.kindHints.${k}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {issue('job.kind') && (
                <p role="alert" className="mt-1 text-caption font-bold text-danger">
                  {issue('job.kind')}
                </p>
              )}
            </fieldset>
            <Field label={th('fields.department')} required error={issue('job.departmentId')}>
              <select
                value={j.departmentId ?? ''}
                onChange={(e) => setJob({ departmentId: e.target.value || undefined })}
                className={box}
              >
                <option value="">–</option>
                {departmentOptions(lookups.departments).map(({ d, depth }) => (
                  <option key={d.id} value={d.id}>
                    {'  '.repeat(depth)}
                    {name(d)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={tp('position')}
              hint={
                position &&
                t('job.gradeRange', {
                  from: position.minGrade ? name(position.minGrade) : '–',
                  to: position.maxGrade ? name(position.maxGrade) : '–',
                })
              }
            >
              <select
                value={j.positionId ?? ''}
                onChange={(e) => {
                  const next = lookups.positions.find((x) => x.id === e.target.value);
                  const allowed = gradesFor(lookups.grades, next);
                  setJob({
                    positionId: next?.id,
                    departmentId: j.departmentId || next?.departmentId,
                    gradeId: allowed.some((g) => g.id === j.gradeId) ? j.gradeId : allowed[0]?.id,
                  });
                }}
                className={box}
              >
                <option value="">–</option>
                {lookups.positions
                  .filter(
                    (x) => x.isActive && (!j.departmentId || x.departmentId === j.departmentId),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {locale === 'ar' ? x.titleAr : x.titleEn}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={tp('grade')}>
              <select
                value={j.gradeId ?? ''}
                onChange={(e) => setJob({ gradeId: e.target.value || undefined })}
                className={box}
              >
                <option value="">–</option>
                {gradesFor(lookups.grades, position).map((g) => (
                  <option key={g.id} value={g.id}>
                    {name(g)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={th('fields.manager')} hint={t('job.managerHint')}>
              <select
                value={j.managerId ?? ''}
                onChange={(e) => setJob({ managerId: e.target.value || undefined })}
                className={box}
              >
                <option value="">
                  {head ? t('job.managerDefault', { name: name(head) }) : t('job.managerNone')}
                </option>
                {lookups.people.map((x) => (
                  <option key={x.id} value={x.id}>
                    {name(x)} ({x.code})
                  </option>
                ))}
              </select>
            </Field>
            {j.kind === 'rider' ? (
              <Field label={t('job.store')} required error={issue('job.storeIds')}>
                <select
                  value={j.storeIds?.[0] ?? ''}
                  onChange={(e) => setJob({ storeIds: e.target.value ? [e.target.value] : [] })}
                  className={box}
                >
                  <option value="">–</option>
                  {myStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {localized(s, locale)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <fieldset className="min-w-0">
                <legend className="text-caption font-bold">{t('job.stores')}</legend>
                <p className="text-caption text-text-muted">{t('job.storesHint')}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {myStores.map((s) => {
                    const on = (j.storeIds ?? []).includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-pill border px-3 text-caption ${
                          on ? 'border-primary font-bold' : 'border-line'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setJob({
                              storeIds: on
                                ? (j.storeIds ?? []).filter((x) => x !== s.id)
                                : [...(j.storeIds ?? []), s.id],
                            })
                          }
                        />
                        {localized(s, locale)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <Field label={th('fields.hireDate')} required error={issue('job.hireDate')}>
              <span className="mt-1 block">
                <DateInput
                  value={j.hireDate ?? ''}
                  onChange={(e) => setJob({ hireDate: e.target.value })}
                  className={dateBox}
                />
              </span>
            </Field>
            <fieldset className="min-w-0">
              <legend className="text-caption font-bold">
                {tp('employment')} <span className="text-danger">*</span>
              </legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(['employee', 'outsourced'] as const).map((k) => (
                  <label
                    key={k}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
                      j.employment === k ? 'border-primary font-bold' : 'border-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="employment"
                      checked={j.employment === k}
                      onChange={() => setJob({ employment: k })}
                    />
                    {tp(`employments.${k}`)}
                  </label>
                ))}
              </div>
              {issue('job.employment') && (
                <p role="alert" className="mt-1 text-caption font-bold text-danger">
                  {issue('job.employment')}
                </p>
              )}
            </fieldset>
            {j.kind === 'rider' && (
              <fieldset className="min-w-0">
                <legend className="text-caption font-bold">{tr('payBasisTitle')}</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(['per_delivery', 'monthly_salary'] as const).map((k) => (
                    <label
                      key={k}
                      className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm ${
                        hirePayBasis(j) === k ? 'border-primary font-bold' : 'border-line'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payBasis"
                        checked={hirePayBasis(j) === k}
                        onChange={() => setJob({ payBasis: k })}
                      />
                      {tr(`payBases.${k}`)}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-caption text-text-muted">
                  {tr(`payBasisHints.${hirePayBasis(j)}`)}
                </p>
              </fieldset>
            )}
            {j.employment === 'outsourced' && (
              <Field
                label={t('job.staffingCompany')}
                required
                error={issue('job.staffingSupplierId')}
              >
                <select
                  value={j.staffingSupplierId ?? ''}
                  onChange={(e) => setJob({ staffingSupplierId: e.target.value || undefined })}
                  className={box}
                >
                  <option value="">–</option>
                  {lookups.suppliers
                    // Riders paid per delivery go through a rider office; offices take only them.
                    .filter(
                      (s) =>
                        !!s.isRiderOffice ===
                        (j.kind === 'rider' && hirePayBasis(j) === 'per_delivery'),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {j.employment !== 'outsourced' && (
              <Field label={th('fields.contractType')}>
                <select
                  value={j.contractType ?? 'permanent'}
                  onChange={(e) =>
                    setJob({
                      contractType: e.target.value as 'permanent' | 'fixed_term' | 'part_time',
                    })
                  }
                  className={box}
                >
                  {(['permanent', 'fixed_term', 'part_time'] as const).map((c) => (
                    <option key={c} value={c}>
                      {th(`contractTypes.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={th('fields.contractEndsOn')} error={issue('job.contractEndsOn')}>
              <span className="mt-1 block">
                <DateInput
                  value={j.contractEndsOn ?? ''}
                  onChange={(e) => setJob({ contractEndsOn: e.target.value })}
                  className={dateBox}
                />
              </span>
            </Field>
            <Field
              label={th('fields.probationEndsOn')}
              error={issue('job.probationEndsOn')}
              hint={
                defaultProbation &&
                !j.probationEndsOn &&
                t('job.probationDefault', {
                  date: isoToDayFirst(defaultProbation),
                  months: probationMonths,
                })
              }
            >
              <span className="mt-1 block">
                <DateInput
                  value={j.probationEndsOn ?? ''}
                  onChange={(e) => setJob({ probationEndsOn: e.target.value })}
                  className={dateBox}
                />
              </span>
            </Field>
            <Field label={t('job.shift')} hint={t('job.shiftHint')}>
              <select
                value={j.defaultShiftId ?? ''}
                onChange={(e) => setJob({ defaultShiftId: e.target.value || undefined })}
                className={box}
              >
                <option value="">{t('job.noShift')}</option>
                {lookups.shifts
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {locale === 'ar' && s.nameAr ? s.nameAr : s.nameEn} ({s.start}–{s.end})
                    </option>
                  ))}
              </select>
            </Field>
            {j.kind === 'rider' && (
              <Field
                label={t('job.badge')}
                required
                error={issue('job.badgeCode')}
                hint={t('job.badgeHint')}
              >
                <input
                  value={j.badgeCode ?? ''}
                  onChange={(e) => setJob({ badgeCode: e.target.value.toUpperCase() })}
                  maxLength={20}
                  className={`${box} ltr-iso`}
                />
              </Field>
            )}
            <Field label={th('fields.jobTitle')} hint={t('job.titleHint')}>
              <input
                value={j.jobTitle ?? ''}
                onChange={(e) => setJob({ jobTitle: e.target.value })}
                maxLength={120}
                className={box}
              />
            </Field>
          </div>
        )}

        {step === 'pay' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label={t('pay.basic')}
              required
              error={issue('pay.basicPiastres')}
              hint={t('pay.fromHire', { date: j.hireDate ? isoToDayFirst(j.hireDate) : '–' })}
            >
              <MoneyBox
                label={t('pay.basic')}
                value={data.pay.basicPiastres}
                onChange={(v) => setPay({ basicPiastres: v })}
              />
            </Field>
            <Field label={t('pay.insured')} hint={t('pay.insuredHint')}>
              <MoneyBox
                label={t('pay.insured')}
                value={data.pay.insuredWagePiastres}
                onChange={(v) => setPay({ insuredWagePiastres: v })}
              />
            </Field>
            <div className="min-w-0 sm:col-span-2">
              <p className="text-caption font-bold">{t('pay.allowances')}</p>
              <ul className="mt-1 space-y-2">
                {allowances.map((x, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[10rem_1fr_9rem_auto]"
                  >
                    <select
                      aria-label={t('pay.kind')}
                      value={x.kind}
                      onChange={(e) =>
                        setPay({
                          allowances: allowances.map((y, k) =>
                            k === i ? { ...y, kind: e.target.value as AllowanceKind } : y,
                          ),
                        })
                      }
                      className={`${box} mt-0`}
                    >
                      {ALLOWANCE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {tp(`allowanceKinds.${k}`)}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={t('pay.label')}
                      placeholder={t('pay.label')}
                      value={x.label ?? ''}
                      onChange={(e) =>
                        setPay({
                          allowances: allowances.map((y, k) =>
                            k === i ? { ...y, label: e.target.value } : y,
                          ),
                        })
                      }
                      maxLength={60}
                      className={`${box} mt-0 hidden sm:block`}
                    />
                    <MoneyBox
                      label={t('pay.amount')}
                      value={x.amountPiastres}
                      onChange={(v) =>
                        setPay({
                          allowances: allowances.map((y, k) =>
                            k === i ? { ...y, amountPiastres: v ?? 0 } : y,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="h-10 self-end px-2 text-caption font-bold text-danger"
                      onClick={() => setPay({ allowances: allowances.filter((_, k) => k !== i) })}
                    >
                      {t('pay.remove')}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-2 text-body-sm font-bold text-link"
                onClick={() =>
                  setPay({ allowances: [...allowances, { kind: 'transport', amountPiastres: 0 }] })
                }
              >
                {t('pay.addAllowance')}
              </button>
              <p className="mt-2 text-body-sm">
                {t('pay.gross')}: <span className="ltr-iso font-bold">{formatEgp(gross)}</span>
              </p>
            </div>
            <h3 className="text-body font-bold sm:col-span-2">{t('pay.bank')}</h3>
            <Field label={th('fields.bankName')}>
              <input
                value={data.pay.bankName ?? ''}
                onChange={(e) => setPay({ bankName: e.target.value })}
                maxLength={80}
                className={box}
              />
            </Field>
            <Field label={th('fields.bankAccountNumber')}>
              <input
                value={data.pay.bankAccountNumber ?? ''}
                onChange={(e) => setPay({ bankAccountNumber: e.target.value })}
                maxLength={40}
                className={`${box} ltr-iso`}
              />
            </Field>
            <Field label={th('fields.iban')} error={issue('pay.iban')}>
              <input
                value={data.pay.iban ?? ''}
                onChange={(e) => setPay({ iban: e.target.value })}
                maxLength={40}
                className={`${box} ltr-iso`}
              />
            </Field>
            <Field label={th('fields.bankAccountHolder')}>
              <input
                value={data.pay.bankAccountHolder ?? ''}
                onChange={(e) => setPay({ bankAccountHolder: e.target.value })}
                maxLength={120}
                className={box}
              />
            </Field>
          </div>
        )}

        {step === 'documents' && draftId && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-line p-3">
              <p className="text-body-sm font-bold">{t('docs.checklist')}</p>
              {required === null ? (
                <p className="mt-1 text-caption text-text-muted">{t('loading')}</p>
              ) : required.filter((x) => x.required).length === 0 ? (
                <p className="mt-1 text-caption text-text-muted">{t('docs.noneRequired')}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {required
                    .filter((x) => x.required)
                    .map((x) => {
                      const added = files.filter((f) => f.typeId === x.id).length;
                      return (
                        <li
                          key={x.id}
                          className="flex items-center justify-between gap-2 text-body-sm"
                        >
                          <span className="min-w-0 truncate">{name(x)}</span>
                          <span
                            className={`shrink-0 rounded-pill border px-2 py-0.5 text-caption font-bold ${
                              added
                                ? 'border-status-delivered text-status-delivered'
                                : 'border-line text-text-muted'
                            }`}
                          >
                            {added ? t('docs.added') : t('docs.later')}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
              <p className="mt-2 text-caption text-text-muted">{t('docs.laterHint')}</p>
            </div>
            <MultiUpload
              uploadPath={`/hr/hire-drafts/${draftId}/files`}
              types={[
                ...(required ?? [])
                  .filter((x) => x.required && !files.some((f) => f.typeId === x.id))
                  .map((x) => ({ ...x, suggested: true })),
                ...lookups.documentTypes
                  .filter(
                    (x) =>
                      x.isActive &&
                      !(required ?? []).some(
                        (r) => r.id === x.id && r.required && !files.some((f) => f.typeId === r.id),
                      ),
                  )
                  .map((x) => ({
                    id: x.id,
                    nameEn: x.nameEn,
                    nameAr: x.nameAr,
                    hasExpiry: x.hasExpiry,
                    allowedTypes: x.allowedTypes,
                    maxBytes: x.maxBytes,
                    suggested: false,
                  })),
              ]}
              onUploaded={() => void reloadFiles()}
            />
            {files.length > 0 && (
              <ul className="divide-y divide-line rounded-md border border-line">
                {files.map((f) => {
                  const type = lookups.documentTypes.find((x) => x.id === f.typeId);
                  return (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <span className="min-w-0 text-body-sm">
                        <span className="block font-bold">{type ? name(type) : '–'}</span>
                        {f.expiresOn && (
                          <span className="text-caption text-text-muted">
                            {tp('expires', { date: isoToDayFirst(f.expiresOn) })}
                          </span>
                        )}
                      </span>
                      <span className="flex gap-2">
                        <a
                          className="inline-flex h-9 items-center rounded-md border border-line px-3 text-body-sm font-bold"
                          href={`/api/hr/hire-drafts/${draftId}/files/${f.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {tp('preview')}
                        </a>
                        <button
                          type="button"
                          className="inline-flex h-9 items-center rounded-md border border-line px-3 text-body-sm font-bold text-danger"
                          onClick={() => void removeFile(f.id)}
                        >
                          {t('docs.removeFile')}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {step === 'access' && (
          <div className="mt-4 space-y-4">
            {j.kind === 'rider' ? (
              <p className="rounded-md border border-line bg-surface-raised p-3 text-body-sm">
                {t('access.riderLogin')}
              </p>
            ) : (
              <fieldset>
                <legend className="text-caption font-bold">{t('access.loginQuestion')}</legend>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {[true, false].map((on) => (
                    <label
                      key={String(on)}
                      className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-md border p-3 text-body-sm ${
                        Boolean(a.login) === on ? 'border-primary' : 'border-line'
                      }`}
                    >
                      <input
                        type="radio"
                        name="login"
                        className="mt-1"
                        checked={Boolean(a.login) === on}
                        onChange={() => setAccess({ login: on })}
                      />
                      <span>
                        <span className="block font-bold">
                          {on ? t('access.withLogin') : t('access.noLogin')}
                        </span>
                        <span className="block text-caption text-text-muted">
                          {on ? t('access.withLoginHint') : t('access.noLoginHint')}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {login && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={tp('email')}
                  required
                  error={issue('person.email')}
                  hint={t('access.emailHint')}
                >
                  <input
                    type="email"
                    value={p.email ?? ''}
                    onChange={(e) => setPerson({ email: e.target.value })}
                    maxLength={200}
                    className={`${box} ltr-iso`}
                  />
                </Field>
                {j.kind !== 'rider' && (
                  <>
                    <Field
                      label={t('access.jobRole')}
                      required
                      error={issue('access.jobRole')}
                      hint={position && t('access.fromPosition')}
                    >
                      <select
                        value={a.jobRole ?? ''}
                        onChange={(e) => {
                          const role = e.target.value as JobRole | '';
                          const d = defaultHireAccess({
                            positionCode: null,
                            storeIds: a.storeIds ?? j.storeIds ?? [],
                          });
                          if (!role) return setAccess({ jobRole: '' });
                          const tpl = hireAccessValues({ jobRole: role });
                          setAccess({
                            ...d,
                            login: true,
                            jobRole: role,
                            allStores: tpl.allStores && grant.allStores,
                            customerData: tpl.customerData && grant.customerData,
                            salaries: tpl.salaries && grant.salaries,
                          });
                        }}
                        className={box}
                      >
                        <option value="">–</option>
                        {JOB_ROLES.filter((r) => r !== 'owner' || grant.settings).map((r) => (
                          <option key={r} value={r}>
                            {tu(`jobRoles.${r}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <fieldset className="min-w-0">
                      <legend className="text-caption font-bold">{t('access.storeScope')}</legend>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {grant.allStores && (
                          <label className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-body-sm">
                            <input
                              type="radio"
                              name="scope"
                              checked={Boolean(a.allStores)}
                              onChange={() => setAccess({ allStores: true })}
                            />
                            {t('access.allStores')}
                          </label>
                        )}
                        <label className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-body-sm">
                          <input
                            type="radio"
                            name="scope"
                            checked={!a.allStores}
                            onChange={() => setAccess({ allStores: false })}
                          />
                          {t('access.listedStores')}
                        </label>
                      </div>
                      {!a.allStores && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {myStores.map((s) => {
                            const on = (a.storeIds ?? []).includes(s.id);
                            return (
                              <label
                                key={s.id}
                                className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-pill border px-3 text-caption ${
                                  on ? 'border-primary font-bold' : 'border-line'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() =>
                                    setAccess({
                                      storeIds: on
                                        ? (a.storeIds ?? []).filter((x) => x !== s.id)
                                        : [...(a.storeIds ?? []), s.id],
                                    })
                                  }
                                />
                                {localized(s, locale)}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {issue('access.storeIds') && (
                        <p role="alert" className="mt-1 text-caption font-bold text-danger">
                          {issue('access.storeIds')}
                        </p>
                      )}
                    </fieldset>
                    <fieldset className="min-w-0 sm:col-span-2">
                      <legend className="text-caption font-bold">{t('access.switches')}</legend>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(['customerData', 'salaries'] as const).map((k) => (
                          <label
                            key={k}
                            className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-body-sm"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(a[k])}
                              disabled={!grant[k] && !(k === 'customerData' && grant.settings)}
                              onChange={(e) => setAccess({ [k]: e.target.checked })}
                            />
                            {t(`access.${k}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {template && (
                      <div className="min-w-0 sm:col-span-2">
                        <p className="text-caption font-bold">
                          {t('access.summary', {
                            role:
                              template.jobRole === 'custom'
                                ? tu('jobRoles.custom')
                                : tu(`jobRoles.${template.jobRole}`),
                          })}
                        </p>
                        <ul className="mt-1 grid grid-cols-2 gap-1 text-caption sm:grid-cols-3">
                          {ACCESS_APPS.filter((x) => template[x] !== 'none').map((x) => (
                            <li key={x} className="rounded-md bg-surface-raised px-2 py-1">
                              {tu(`access.apps.${x}`)}:{' '}
                              <span className="font-bold">
                                {tu(`access.levels.${template[x]}`)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <Review
            data={data}
            steps={steps}
            lookups={lookups}
            files={files.length}
            issues={issues}
            onEdit={(s) => void jump(s)}
          />
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger p-3 text-body-sm text-danger"
        >
          {error}
        </p>
      )}
      {Object.keys(issues).length > 0 && (
        <p role="alert" className="mt-3 text-body-sm font-bold text-danger">
          {t('fixIssues', { count: Object.keys(issues).length })}
        </p>
      )}

      {/* Back, Next, save for later; sticky at the bottom on phones. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-line bg-bg px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        {at > 0 && (
          <button type="button" className={secondary} disabled={busy} onClick={() => void goBack()}>
            {t('back')}
          </button>
        )}
        {step !== 'review' ? (
          <button type="button" className={primary} disabled={busy} onClick={() => void goNext()}>
            {t('next')}
          </button>
        ) : (
          <button type="button" className={primary} disabled={busy} onClick={() => void create()}>
            {busy ? t('creating') : t('create')}
          </button>
        )}
        <button
          type="button"
          className="ms-auto text-body-sm font-bold text-link disabled:opacity-50"
          disabled={busy || !p.nameEn}
          onClick={() => void saveAndClose()}
        >
          {t('saveForLater')}
        </button>
        {draftId && (
          <button
            type="button"
            className="text-body-sm font-bold text-danger"
            disabled={busy}
            onClick={() => void discard()}
          >
            {t('discard')}
          </button>
        )}
        {saved && (
          <span role="status" className="w-full text-caption text-text-muted">
            {saved}
          </span>
        )}
      </div>
    </div>
  );
}

/** Everything typed, step by step, with Edit links back and what still stops the create. */
function Review({
  data,
  steps,
  lookups,
  files,
  issues,
  onEdit,
}: {
  data: HireDraftData;
  steps: HireStep[];
  lookups: HireLookups;
  files: number;
  issues: StepIssues;
  onEdit: (s: HireStep) => void;
}) {
  const t = useTranslations('hr2');
  const tu = useTranslations('admin.users');
  const th = useTranslations('hr');
  const tp = useTranslations('people');
  const tr = useTranslations('riderPay');
  const locale = useLocale();
  const p = data.person;
  const j = data.job;
  const a = data.access;
  const named = (x: { nameEn: string; nameAr: string | null } | undefined) =>
    x ? (locale === 'ar' && x.nameAr ? x.nameAr : x.nameEn) : '–';
  const day = (d: string | undefined) =>
    d ? <span className="ltr-iso">{isoToDayFirst(d)}</span> : '–';
  const position = lookups.positions.find((x) => x.id === j.positionId);
  const stores = lookups.stores
    .filter((s) => (j.storeIds ?? []).includes(s.id))
    .map((s) => localized(s, locale))
    .join('، ');
  const login = j.kind === 'rider' || Boolean(a.login);
  const rows: { step: HireStep; lines: [string, ReactNode][] }[] = [
    {
      step: 'person',
      lines: [
        [th('fields.nameEn'), p.nameEn || '–'],
        [th('fields.nameAr'), p.nameAr || '–'],
        [
          th('fields.mobile'),
          <span key="m" className="ltr-iso">
            {p.mobile || '–'}
          </span>,
        ],
        [
          tp('email'),
          <span key="e" className="ltr-iso break-all">
            {p.email || '–'}
          </span>,
        ],
        [
          th('fields.nationalId'),
          <span key="n" className="ltr-iso">
            {p.nationalId || '–'}
          </span>,
        ],
        [th('fields.birthDate'), day(p.birthDate)],
      ],
    },
    {
      step: 'job',
      lines: [
        [t('job.kind'), j.kind ? t(`job.kinds.${j.kind}`) : '–'],
        [th('fields.department'), named(lookups.departments.find((d) => d.id === j.departmentId))],
        [tp('position'), position ? (locale === 'ar' ? position.titleAr : position.titleEn) : '–'],
        [tp('grade'), named(lookups.grades.find((g) => g.id === j.gradeId))],
        [
          th('fields.manager'),
          j.managerId
            ? named(lookups.people.find((x) => x.id === j.managerId))
            : t('job.fromChain'),
        ],
        [t('job.stores'), stores || th('office')],
        [th('fields.hireDate'), day(j.hireDate)],
        [tp('employment'), j.employment ? tp(`employments.${j.employment}`) : '–'],
        ...(j.kind === 'rider'
          ? [[tr('payBasisTitle'), tr(`payBases.${hirePayBasis(j)}`)] as [string, string]]
          : []),
        [
          th('fields.probationEndsOn'),
          j.probationEndsOn ? day(j.probationEndsOn) : t('job.probationAuto'),
        ],
        [
          t('job.shift'),
          lookups.shifts.find((s) => s.id === j.defaultShiftId)?.nameEn ?? t('job.noShift'),
        ],
      ],
    },
    ...(steps.includes('pay')
      ? [
          {
            step: 'pay' as const,
            lines: [
              [
                t('pay.basic'),
                <span key="b" className="ltr-iso">
                  {data.pay.basicPiastres != null ? formatEgp(data.pay.basicPiastres) : '–'}
                </span>,
              ],
              [t('pay.allowances'), String((data.pay.allowances ?? []).length)],
              [
                th('fields.iban'),
                <span key="i" className="ltr-iso">
                  {data.pay.iban || '–'}
                </span>,
              ],
            ] as [string, ReactNode][],
          },
        ]
      : []),
    { step: 'documents', lines: [[t('docs.addedCount'), String(files)]] },
    {
      step: 'access',
      lines: [
        [t('access.login'), login ? t('access.withLogin') : t('access.noLogin')],
        ...(login && j.kind !== 'rider'
          ? ([
              [t('access.jobRole'), a.jobRole ? tu(`jobRoles.${a.jobRole}`) : '–'],
              [
                t('access.storeScope'),
                a.allStores ? t('access.allStores') : t('access.listedStores'),
              ],
            ] as [string, ReactNode][])
          : []),
      ],
    },
  ];
  const left = Object.entries(issues);
  return (
    <div className="mt-4 space-y-3">
      {left.length > 0 && (
        <ul className="rounded-md border border-danger p-3 text-body-sm">
          {left.map(([k, code]) => (
            <li key={k}>
              <button
                type="button"
                className="text-start font-bold text-danger underline"
                onClick={() => onEdit(stepOfField(k))}
              >
                {t(`steps.${stepOfField(k)}`)}: {t(`issues.${code}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <section key={r.step} className="min-w-0 rounded-md border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-body font-bold">{t(`steps.${r.step}`)}</h3>
              <button
                type="button"
                className="text-body-sm font-bold text-link"
                onClick={() => onEdit(r.step)}
              >
                {t('edit')}
              </button>
            </div>
            <dl className="mt-2">
              {r.lines.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-0.5 text-body-sm">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="min-w-0 text-end font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="text-caption text-text-muted">{t('createHint')}</p>
    </div>
  );
}

/** After create: the file, and the setup link shown once (copy it now). */
function Done({ result, name }: { result: HireResult; name: string }) {
  const t = useTranslations('hr2');
  const [copied, setCopied] = useState(false);
  const link =
    result.setupToken && typeof window !== 'undefined'
      ? setupLink(window.location.origin, result.setupToken)
      : null;
  return (
    <section
      className="mt-4 max-w-2xl rounded-lg border border-status-delivered bg-surface p-4"
      aria-live="polite"
    >
      <h2 className="text-h3">{t('done.title', { name, code: result.code })}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('done.body')}</p>
      {link ? (
        <div className="mt-3 rounded-md border border-line bg-surface-raised p-3">
          <p className="text-body-sm font-bold">{t('done.linkTitle')}</p>
          <p className="mt-1 text-caption text-text-muted">{t('done.linkHint')}</p>
          <p className="ltr-iso mt-2 break-all rounded bg-surface p-2 text-caption">{link}</p>
          <button
            type="button"
            className="mt-2 h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? t('done.copied') : t('done.copy')}
          </button>
        </div>
      ) : result.repeated ? (
        <p className="mt-3 text-body-sm">{t('done.repeated')}</p>
      ) : (
        <p className="mt-3 text-body-sm">{t('done.noLogin')}</p>
      )}
      {result.payPending && <p className="mt-3 text-body-sm">{t('done.payPending')}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/admin/hr/${result.employeeId}`} className={primary}>
          {t('done.openFile')}
        </Link>
        <Link href="/admin/hr/hire" className={secondary}>
          {t('done.another')}
        </Link>
      </div>
    </section>
  );
}
