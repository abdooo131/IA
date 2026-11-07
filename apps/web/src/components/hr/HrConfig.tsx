'use client';

import { DOCUMENT_TYPES, TASK_OWNERS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import {
  type ChecklistTemplateRow,
  departmentOptions,
  type DepartmentRow,
  type DocumentTypeRow,
  employeeName,
  type EmployeeRow,
  type GradeRow,
  type PositionRow,
  type StoreRef,
} from '@/lib/hr-types';
import { parseEgp } from '@/lib/money';

// HR configuration (docs/HR.md): departments, positions, grades, document types and checklist
// templates. Everyone with HR view reads them; HR manage changes them.

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';
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

// ─── departments ─────────────────────────────────────────────────────────────

export function DepartmentsEditor({
  rows,
  people,
  stores,
  canManage,
}: {
  rows: DepartmentRow[];
  people: EmployeeRow[];
  stores: StoreRef[];
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
    parentId: '',
    headEmployeeId: '',
    costStoreId: '',
    sort: '0',
    isActive: true,
  };
  const [form, setForm] = useState(blank);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const start = (d: DepartmentRow | null) => {
    setEditing(d?.id ?? 'new');
    setForm(
      d
        ? {
            code: d.code,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            parentId: d.parentId ?? '',
            headEmployeeId: d.head?.id ?? '',
            costStoreId: d.costStore?.id ?? '',
            sort: String(d.sort),
            isActive: d.isActive,
          }
        : blank,
    );
  };
  async function submit() {
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      parentId: form.parentId || null,
      headEmployeeId: form.headEmployeeId || null,
      costStoreId: form.costStoreId || null,
      sort: Number(form.sort) || 0,
      isActive: form.isActive,
    };
    const ok =
      editing === 'new'
        ? await save.send('POST', '/hr/departments', { ...body, code: form.code })
        : await save.send('PATCH', `/hr/departments/${editing}`, body);
    if (ok) setEditing(null);
  }
  const ordered = [
    ...departmentOptions(rows),
    ...rows.filter((r) => !r.isActive).map((d) => ({ d, depth: 0 })),
  ];
  const editor = (
    <div className="mt-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
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
        {t('parent')}
        <select
          value={form.parentId}
          onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          className={field}
        >
          <option value="">{t('topLevel')}</option>
          {departmentOptions(rows)
            .filter(({ d }) => d.id !== editing)
            .map(({ d, depth }) => (
              <option key={d.id} value={d.id}>
                {'  '.repeat(depth)}
                {name(d)}
              </option>
            ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('head')}
        <select
          value={form.headEmployeeId}
          onChange={(e) => setForm({ ...form, headEmployeeId: e.target.value })}
          className={field}
        >
          <option value="">{t('noHead')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {employeeName(p, locale)} ({p.code})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('costStore')}
        <select
          value={form.costStoreId}
          onChange={(e) => setForm({ ...form, costStoreId: e.target.value })}
          className={field}
        >
          <option value="">{t('companyWide')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, locale)}
            </option>
          ))}
        </select>
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
      <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        {t('active')}
      </label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button
          type="button"
          className={primary}
          disabled={save.busy}
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
    <Panel title={t('departmentsTitle')}>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addDepartment')}
        </button>
      )}
      {editing === 'new' && editor}
      <Message error={save.error} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('department')}</th>
              <th className={th}>{t('head')}</th>
              <th className={th}>{t('costStore')}</th>
              <th className={`${th} text-end`}>{t('people')}</th>
              <th className={`${th} text-end`}>{t('positionsCount')}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ordered.map(({ d, depth }) => (
              <tr key={d.id}>
                <td className={td} colSpan={editing === d.id ? 6 : 1}>
                  <span style={{ paddingInlineStart: depth * 20 }} className="inline-block">
                    {depth > 0 && <span className="me-1 text-text-muted">└</span>}
                    <span className="font-bold">{name(d)}</span>
                    <span className="ltr-iso ms-2 text-caption text-text-muted">{d.code}</span>
                    <ActiveChip active={d.isActive} />
                  </span>
                  {editing === d.id && editor}
                </td>
                {editing !== d.id && (
                  <>
                    <td className={td}>{d.head ? employeeName(d.head, locale) : '–'}</td>
                    <td className={td}>{d.costStore ? localized(d.costStore, locale) : '–'}</td>
                    <td className={`${td} ltr-iso text-end`}>{d.members}</td>
                    <td className={`${td} ltr-iso text-end`}>{d.positions}</td>
                    <td className={`${td} text-end`}>
                      {canManage && (
                        <button type="button" className={small} onClick={() => start(d)}>
                          {t('edit')}
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─── grades ──────────────────────────────────────────────────────────────────

export function GradesEditor({ rows, canManage }: { rows: GradeRow[]; canManage: boolean }) {
  const t = useTranslations('people');
  const locale = useLocale();
  const save = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const egp = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));
  const blank = {
    code: '',
    nameEn: '',
    nameAr: '',
    rank: '',
    min: '',
    max: '',
    leave: '',
    isActive: true,
  };
  const [form, setForm] = useState(blank);
  const start = (g: GradeRow | null) => {
    setEditing(g?.id ?? 'new');
    setForm(
      g
        ? {
            code: g.code,
            nameEn: g.nameEn,
            nameAr: g.nameAr,
            rank: String(g.rank),
            min: egp(g.bandMinPiastres),
            max: egp(g.bandMaxPiastres),
            leave: g.annualLeaveDays == null ? '' : String(g.annualLeaveDays),
            isActive: g.isActive,
          }
        : { ...blank, rank: String((rows.at(-1)?.rank ?? 0) + 1) },
    );
  };
  async function submit() {
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      rank: Number(form.rank),
      bandMinPiastres: form.min.trim() ? parseEgp(form.min) : null,
      bandMaxPiastres: form.max.trim() ? parseEgp(form.max) : null,
      annualLeaveDays: form.leave.trim() ? Number(form.leave) : null,
      isActive: form.isActive,
    };
    const ok =
      editing === 'new'
        ? await save.send('POST', '/hr/grades', { ...body, code: form.code })
        : await save.send('PATCH', `/hr/grades/${editing}`, body);
    if (ok) setEditing(null);
  }
  const editor = (
    <div className="mt-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3 lg:grid-cols-6">
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
        {t('rank')}
        <input
          value={form.rank}
          onChange={(e) => setForm({ ...form, rank: e.target.value })}
          inputMode="numeric"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('bandMin')}
        <input
          value={form.min}
          onChange={(e) => setForm({ ...form, min: e.target.value })}
          inputMode="decimal"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('bandMax')}
        <input
          value={form.max}
          onChange={(e) => setForm({ ...form, max: e.target.value })}
          inputMode="decimal"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('annualLeaveDays')}
        <input
          value={form.leave}
          onChange={(e) => setForm({ ...form, leave: e.target.value })}
          inputMode="numeric"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        {t('active')}
      </label>
      <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
        <button
          type="button"
          className={primary}
          disabled={save.busy}
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
    <Panel title={t('gradesTitle')}>
      <p className="mt-1 text-caption text-text-muted">{t('gradesHint')}</p>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addGrade')}
        </button>
      )}
      {editing === 'new' && editor}
      <Message error={save.error} />
      <ol className="mt-3 divide-y divide-line rounded-md border border-line">
        {[...rows].reverse().map((g, i, all) => (
          <li key={g.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="ltr-iso flex h-8 w-8 items-center justify-center rounded-full bg-selected-bg text-caption font-bold text-link">
                {g.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-bold">{locale === 'ar' ? g.nameAr : g.nameEn}</span>
                <span className="ltr-iso ms-2 text-caption text-text-muted">{g.code}</span>
                <ActiveChip active={g.isActive} />
                <span className="block text-caption text-text-muted">
                  {g.bandMinPiastres != null || g.bandMaxPiastres != null
                    ? t('bandRange', {
                        min: g.bandMinPiastres != null ? formatEgp(g.bandMinPiastres) : '–',
                        max: g.bandMaxPiastres != null ? formatEgp(g.bandMaxPiastres) : '–',
                      })
                    : t('noBand')}
                  {g.annualLeaveDays != null && (
                    <>
                      {' · '}
                      {t('annualLeaveShort', { days: g.annualLeaveDays })}
                    </>
                  )}
                  {' · '}
                  {t('peopleCount', { count: g.people })}
                </span>
              </span>
              {canManage && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    className={small}
                    disabled={i === 0 || save.busy}
                    aria-label={t('moveUp')}
                    title={t('moveUp')}
                    onClick={() => void save.send('POST', `/hr/grades/${g.id}/move?direction=up`)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={i === all.length - 1 || save.busy}
                    aria-label={t('moveDown')}
                    title={t('moveDown')}
                    onClick={() => void save.send('POST', `/hr/grades/${g.id}/move?direction=down`)}
                  >
                    ↓
                  </button>
                  <button type="button" className={small} onClick={() => start(g)}>
                    {t('edit')}
                  </button>
                </span>
              )}
            </div>
            {editing === g.id && editor}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ─── positions ───────────────────────────────────────────────────────────────

export function PositionsEditor({
  rows,
  departments,
  grades,
  canManage,
}: {
  rows: PositionRow[];
  departments: DepartmentRow[];
  grades: GradeRow[];
  canManage: boolean;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const save = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const blank = {
    code: '',
    titleEn: '',
    titleAr: '',
    departmentId: '',
    minGradeId: '',
    maxGradeId: '',
    planned: '0',
    leave: '',
    isActive: true,
  };
  const [form, setForm] = useState(blank);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const start = (p: PositionRow | null) => {
    setEditing(p?.id ?? 'new');
    setForm(
      p
        ? {
            code: p.code,
            titleEn: p.titleEn,
            titleAr: p.titleAr,
            departmentId: p.departmentId,
            minGradeId: p.minGradeId ?? '',
            maxGradeId: p.maxGradeId ?? '',
            planned: String(p.headcountPlanned),
            leave: p.annualLeaveDays == null ? '' : String(p.annualLeaveDays),
            isActive: p.isActive,
          }
        : blank,
    );
  };
  async function submit() {
    const body = {
      titleEn: form.titleEn,
      titleAr: form.titleAr,
      departmentId: form.departmentId,
      minGradeId: form.minGradeId || null,
      maxGradeId: form.maxGradeId || null,
      headcountPlanned: Number(form.planned) || 0,
      annualLeaveDays: form.leave.trim() ? Number(form.leave) : null,
      isActive: form.isActive,
    };
    const ok =
      editing === 'new'
        ? await save.send('POST', '/hr/positions', { ...body, code: form.code })
        : await save.send('PATCH', `/hr/positions/${editing}`, body);
    if (ok) setEditing(null);
  }
  const gradeSelect = (key: 'minGradeId' | 'maxGradeId', label: string) => (
    <label className="block text-caption">
      {label}
      <select
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={field}
      >
        <option value="">–</option>
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {name(g)}
          </option>
        ))}
      </select>
    </label>
  );
  const editor = (
    <div className="mt-3 grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
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
        {t('titleEn')}
        <input
          value={form.titleEn}
          onChange={(e) => setForm({ ...form, titleEn: e.target.value })}
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('titleAr')}
        <input
          value={form.titleAr}
          onChange={(e) => setForm({ ...form, titleAr: e.target.value })}
          dir="rtl"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('department')}
        <select
          value={form.departmentId}
          onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          className={field}
        >
          <option value="">–</option>
          {departmentOptions(departments).map(({ d, depth }) => (
            <option key={d.id} value={d.id}>
              {'  '.repeat(depth)}
              {name(d)}
            </option>
          ))}
        </select>
      </label>
      {gradeSelect('minGradeId', t('minGrade'))}
      {gradeSelect('maxGradeId', t('maxGrade'))}
      <label className="block text-caption">
        {t('planned')}
        <input
          value={form.planned}
          onChange={(e) => setForm({ ...form, planned: e.target.value })}
          inputMode="numeric"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('annualLeaveDays')}
        <input
          value={form.leave}
          onChange={(e) => setForm({ ...form, leave: e.target.value })}
          inputMode="numeric"
          dir="ltr"
          className={field}
        />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-body-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        {t('active')}
      </label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button
          type="button"
          className={primary}
          disabled={save.busy || !form.departmentId}
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
    <Panel title={t('positionsTitle')}>
      {canManage && editing !== 'new' && (
        <button type="button" className={`${primary} mt-3`} onClick={() => start(null)}>
          {t('addPosition')}
        </button>
      )}
      {editing === 'new' && editor}
      <Message error={save.error} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('position')}</th>
              <th className={th}>{t('department')}</th>
              <th className={th}>{t('gradeRange')}</th>
              <th className={`${th} text-end`}>{t('planned')}</th>
              <th className={`${th} text-end`}>{t('filled')}</th>
              <th className={`${th} text-end`}>{t('openCol')}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className={td} colSpan={editing === p.id ? 7 : 1}>
                  <span className="font-bold">{locale === 'ar' ? p.titleAr : p.titleEn}</span>
                  <span className="ltr-iso ms-2 text-caption text-text-muted">{p.code}</span>
                  <ActiveChip active={p.isActive} />
                  {p.annualLeaveDays != null && (
                    <span className="block text-caption text-text-muted">
                      {t('annualLeaveShort', { days: p.annualLeaveDays })}
                    </span>
                  )}
                  {editing === p.id && editor}
                </td>
                {editing !== p.id && (
                  <>
                    <td className={td}>{name(p.department)}</td>
                    <td className={td}>
                      {p.minGrade || p.maxGrade
                        ? `${p.minGrade ? name(p.minGrade) : '–'} → ${p.maxGrade ? name(p.maxGrade) : '–'}`
                        : '–'}
                    </td>
                    <td className={`${td} ltr-iso text-end`}>{p.headcountPlanned}</td>
                    <td className={`${td} ltr-iso text-end`}>{p.filled}</td>
                    <td
                      className={`${td} ltr-iso text-end ${p.open > 0 ? 'font-bold text-status-needs-action' : ''}`}
                    >
                      {p.open}
                    </td>
                    <td className={`${td} text-end`}>
                      {canManage && (
                        <button type="button" className={small} onClick={() => start(p)}>
                          {t('edit')}
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

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
