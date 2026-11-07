'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import { formatEgp } from '@/lib/format';
import {
  departmentOptions,
  type DepartmentRow,
  employeeName,
  type EmployeeRow,
  type GradeRow,
  type PositionRow,
  type StoreRef,
} from '@/lib/hr-types';
import { ORG_TABS, type OrgTab } from '@/lib/hr-phase1';
import { parseEgp } from '@/lib/money';

// HR phase 1: one organisation setup page. Departments as a tree with the selected one's
// positions beside it, every position in one table, and grades as a compact ordered table.
// Adding and editing happen in a side panel. HR view reads; HR manage changes.

const field =
  'mt-1 block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';
const small =
  'inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:opacity-50';
const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';

type Panel =
  | { kind: 'department'; row: DepartmentRow | null }
  | { kind: 'position'; row: PositionRow | null; departmentId?: string }
  | { kind: 'grade'; row: GradeRow | null };

function useSave(onDone: () => void) {
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
    onDone();
    return true;
  }
  return { busy, error, send, setError };
}

/** A panel that slides in from the end side (full width on phones). Escape closes it. */
function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations('hr1');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t('org.close')}
        className="absolute inset-0 bg-shiply-navy/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface p-4 shadow-lg sm:p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h3">{title}</h2>
          <button type="button" className={small} onClick={onClose}>
            {t('org.close')}
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function OrganisationSetup({
  tab,
  selectedId,
  departments,
  positions,
  grades,
  people,
  stores,
  canManage,
}: {
  tab: OrgTab;
  selectedId: string | null;
  departments: DepartmentRow[];
  positions: PositionRow[];
  grades: GradeRow[];
  people: EmployeeRow[];
  stores: StoreRef[];
  canManage: boolean;
}) {
  const t = useTranslations('hr1');
  const tp = useTranslations('people');
  const locale = useLocale();
  const [panel, setPanel] = useState<Panel | null>(null);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const title = (p: PositionRow) => (locale === 'ar' ? p.titleAr : p.titleEn);
  const active = departments.filter((d) => d.isActive);
  const selected =
    departments.find((d) => d.id === selectedId) ??
    active.find((d) => !d.parentId) ??
    departments[0] ??
    null;
  const tabHref = (k: OrgTab) => `/admin/hr/organisation?tab=${k}`;
  const gradeRange = (p: PositionRow) =>
    p.minGrade || p.maxGrade
      ? `${p.minGrade ? name(p.minGrade) : '–'} → ${p.maxGrade ? name(p.maxGrade) : '–'}`
      : '–';

  const positionsTable = (rows: PositionRow[], withDepartment: boolean) =>
    rows.length === 0 ? (
      <p className="p-4 text-body-sm text-text-muted">{t('org.noPositions')}</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-body-sm">
          <thead>
            <tr>
              <th className={th}>{tp('position')}</th>
              {withDepartment && <th className={th}>{tp('department')}</th>}
              <th className={th}>{tp('gradeRange')}</th>
              <th className={`${th} text-end`}>{t('org.plannedActual')}</th>
              <th className={`${th} text-end`}>{t('org.leaveDays')}</th>
              {canManage && <th className={th} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <span className="font-bold">{title(p)}</span>
                  <span className="ltr-iso ms-2 text-caption text-text-muted">{p.code}</span>
                  {!p.isActive && <Inactive />}
                </td>
                {withDepartment && <td className={td}>{name(p.department)}</td>}
                <td className={td}>{gradeRange(p)}</td>
                <td className={`${td} ltr-iso text-end`}>
                  <span className={p.open > 0 ? 'font-bold text-status-needs-action' : ''}>
                    {p.headcountPlanned} / {p.filled}
                  </span>
                  {p.open > 0 && (
                    <span className="block text-caption text-status-needs-action">
                      {t('org.openPlaces', { count: p.open })}
                    </span>
                  )}
                </td>
                <td className={`${td} ltr-iso text-end`}>{p.annualLeaveDays ?? '–'}</td>
                {canManage && (
                  <td className={`${td} text-end`}>
                    <button
                      type="button"
                      className={small}
                      onClick={() => setPanel({ kind: 'position', row: p })}
                    >
                      {tp('edit')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <>
      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-line"
        aria-label={t('org.tabs')}
      >
        {ORG_TABS.map((k) => (
          <Link
            key={k}
            href={tabHref(k)}
            aria-current={tab === k ? 'page' : undefined}
            className={`flex h-10 shrink-0 items-center border-b-2 px-3 text-body-sm font-bold ${
              tab === k
                ? 'border-primary text-link'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t(`org.tab.${k}`)}
          </Link>
        ))}
      </nav>

      {tab === 'structure' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section className="min-w-0 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-h3">{tp('departmentsTitle')}</h2>
              {canManage && (
                <button
                  type="button"
                  className={small}
                  onClick={() => setPanel({ kind: 'department', row: null })}
                >
                  {t('org.add')}
                </button>
              )}
            </div>
            {departments.length === 0 ? (
              <p className="mt-3 px-1 text-body-sm text-text-muted">{t('org.noDepartments')}</p>
            ) : (
              <DepartmentTree
                departments={departments}
                selectedId={selected?.id ?? null}
                name={name}
              />
            )}
          </section>

          {selected && (
            <section className="min-w-0 rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line p-4">
                <div className="min-w-0">
                  <h2 className="text-h3">
                    {name(selected)}
                    <span className="ltr-iso ms-2 text-caption font-normal text-text-muted">
                      {selected.code}
                    </span>
                    {!selected.isActive && <Inactive />}
                  </h2>
                  <p className="mt-1 text-body-sm text-text-muted">
                    {tp('head')}:{' '}
                    {selected.head ? (
                      <Link href={`/admin/hr/${selected.head.id}`} className="text-link">
                        {employeeName(selected.head, locale)}
                      </Link>
                    ) : (
                      t('org.noHeadPasses')
                    )}
                    {' · '}
                    {tp('costStore')}:{' '}
                    {selected.costStore ? localized(selected.costStore, locale) : tp('companyWide')}
                  </p>
                  <p className="mt-1 text-body-sm">
                    <Link href={`/admin/hr?department=${selected.id}`} className="text-link">
                      {tp('peopleCount', { count: selected.members })}
                    </Link>
                  </p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={small}
                      onClick={() => setPanel({ kind: 'department', row: selected })}
                    >
                      {tp('edit')}
                    </button>
                    <button
                      type="button"
                      className={primary}
                      onClick={() =>
                        setPanel({ kind: 'position', row: null, departmentId: selected.id })
                      }
                    >
                      {tp('addPosition')}
                    </button>
                  </div>
                )}
              </div>
              <h3 className="px-4 pt-3 text-label uppercase text-text-muted">
                {tp('positionsTitle')}
              </h3>
              {positionsTable(
                positions.filter((p) => p.departmentId === selected.id),
                false,
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'positions' && (
        <section className="mt-4 rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
            <p className="text-body-sm text-text-muted">{tp('positionsIntro')}</p>
            {canManage && (
              <button
                type="button"
                className={primary}
                onClick={() => setPanel({ kind: 'position', row: null })}
              >
                {tp('addPosition')}
              </button>
            )}
          </div>
          {positionsTable(positions, true)}
        </section>
      )}

      {tab === 'grades' && (
        <GradesTable
          grades={grades}
          canManage={canManage}
          onEdit={(row) => setPanel({ kind: 'grade', row })}
        />
      )}

      {panel?.kind === 'department' && (
        <DepartmentForm
          row={panel.row}
          departments={departments}
          people={people}
          stores={stores}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'position' && (
        <PositionForm
          row={panel.row}
          departmentId={panel.departmentId}
          departments={departments}
          grades={grades}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'grade' && (
        <GradeForm row={panel.row} grades={grades} onClose={() => setPanel(null)} />
      )}
    </>
  );
}

function Inactive() {
  const t = useTranslations('people');
  return (
    <span className="ms-2 rounded-pill border border-line px-2 text-caption font-normal text-text-muted">
      {t('inactive')}
    </span>
  );
}

/** The department tree: expand or fold each branch; the selected one opens on the right. */
function DepartmentTree({
  departments,
  selectedId,
  name,
}: {
  departments: DepartmentRow[];
  selectedId: string | null;
  name: (x: { nameEn: string; nameAr: string }) => string;
}) {
  const t = useTranslations('hr1');
  const locale = useLocale();
  const children = useMemo(() => {
    const m = new Map<string | null, DepartmentRow[]>();
    const ids = new Set(departments.map((d) => d.id));
    for (const d of departments) {
      const parent = d.parentId && ids.has(d.parentId) ? d.parentId : null;
      m.set(parent, [...(m.get(parent) ?? []), d]);
    }
    for (const list of m.values())
      list.sort((a, b) => a.sort - b.sort || a.nameEn.localeCompare(b.nameEn));
    return m;
  }, [departments]);
  // Open the top two levels and the path to the selected one.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const top of children.get(null) ?? []) s.add(top.id);
    const parent = new Map(departments.map((d) => [d.id, d.parentId]));
    for (let c = selectedId ? parent.get(selectedId) : null, i = 0; c && i < 50; i++) {
      s.add(c);
      c = parent.get(c) ?? null;
    }
    return s;
  });
  const total = (id: string): number =>
    (departments.find((d) => d.id === id)?.members ?? 0) +
    (children.get(id) ?? []).reduce((sum, c) => sum + total(c.id), 0);
  const node = (d: DepartmentRow, depth: number): ReactNode => {
    const kids = children.get(d.id) ?? [];
    const isOpen = open.has(d.id);
    const here = d.id === selectedId;
    return (
      <li key={d.id}>
        <div
          className={`flex min-h-10 items-center gap-1 rounded-md pe-2 ${here ? 'bg-selected-bg' : 'hover:bg-surface-raised'}`}
          style={{ paddingInlineStart: depth * 16 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={isOpen ? t('org.fold') : t('org.unfold')}
              onClick={() =>
                setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(d.id)) n.delete(d.id);
                  else n.add(d.id);
                  return n;
                })
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className={isOpen ? '' : 'ltr:-rotate-90 rtl:rotate-90'}
              >
                <path d="M3 4.5 6 7.5 9 4.5" />
              </svg>
            </button>
          ) : (
            <span className="w-9 shrink-0" />
          )}
          <Link
            href={`/admin/hr/organisation?tab=structure&department=${d.id}`}
            scroll={false}
            aria-current={here ? 'true' : undefined}
            className="min-w-0 flex-1 py-1"
          >
            <span
              className={`block truncate text-body-sm ${here ? 'font-bold text-link' : 'font-semibold'}`}
            >
              {name(d)}
              {!d.isActive && <span className="text-text-muted"> · {t('org.closed')}</span>}
            </span>
            <span className="block truncate text-caption text-text-muted">
              {d.head ? employeeName(d.head, locale) : t('org.noHead')}
            </span>
          </Link>
          <span
            className="ltr-iso shrink-0 rounded-pill bg-surface-raised px-2 text-caption"
            title={t('org.headcount')}
          >
            {total(d.id)}
          </span>
        </div>
        {kids.length > 0 && isOpen && <ul>{kids.map((k) => node(k, depth + 1))}</ul>}
      </li>
    );
  };
  return <ul className="mt-2">{(children.get(null) ?? []).map((d) => node(d, 0))}</ul>;
}

function GradesTable({
  grades,
  canManage,
  onEdit,
}: {
  grades: GradeRow[];
  canManage: boolean;
  onEdit: (row: GradeRow | null) => void;
}) {
  const t = useTranslations('hr1');
  const tp = useTranslations('people');
  const locale = useLocale();
  const save = useSave(() => undefined);
  const ordered = [...grades].sort((a, b) => b.rank - a.rank);
  const band = (g: GradeRow) =>
    g.bandMinPiastres != null || g.bandMaxPiastres != null
      ? `${g.bandMinPiastres != null ? formatEgp(g.bandMinPiastres) : '–'} – ${g.bandMaxPiastres != null ? formatEgp(g.bandMaxPiastres) : '–'}`
      : tp('noBand');
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
        <p className="text-body-sm text-text-muted">
          {tp('gradesIntro')} {canManage && tp('gradesHint')}
        </p>
        {canManage && (
          <button type="button" className={primary} onClick={() => onEdit(null)}>
            {tp('addGrade')}
          </button>
        )}
      </div>
      {save.error && (
        <p role="alert" className="px-4 pt-3 text-body-sm text-danger">
          {save.error}
        </p>
      )}
      {ordered.length === 0 ? (
        <p className="p-4 text-body-sm text-text-muted">{t('org.noGrades')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-body-sm">
            <thead>
              <tr>
                <th className={th}>{tp('rank')}</th>
                <th className={th}>{tp('grade')}</th>
                <th className={th}>{t('org.band')}</th>
                <th className={`${th} text-end`}>{t('org.leaveDays')}</th>
                <th className={`${th} text-end`}>{tp('people')}</th>
                {canManage && <th className={th} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ordered.map((g, i) => (
                <tr key={g.id}>
                  <td className={`${td} ltr-iso`}>{g.rank}</td>
                  <td className={td}>
                    <span className="font-bold">{locale === 'ar' ? g.nameAr : g.nameEn}</span>
                    <span className="ltr-iso ms-2 text-caption text-text-muted">{g.code}</span>
                    {!g.isActive && <Inactive />}
                  </td>
                  <td className={`${td} ltr-iso`}>{band(g)}</td>
                  <td className={`${td} ltr-iso text-end`}>{g.annualLeaveDays ?? '–'}</td>
                  <td className={`${td} ltr-iso text-end`}>
                    <Link href={`/admin/hr?grade=${g.id}`} className="text-link">
                      {g.people}
                    </Link>
                  </td>
                  {canManage && (
                    <td className={`${td} text-end`}>
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          className={small}
                          disabled={i === 0 || save.busy}
                          aria-label={tp('moveUp')}
                          title={tp('moveUp')}
                          onClick={() =>
                            void save.send('POST', `/hr/grades/${g.id}/move?direction=up`)
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={small}
                          disabled={i === ordered.length - 1 || save.busy}
                          aria-label={tp('moveDown')}
                          title={tp('moveDown')}
                          onClick={() =>
                            void save.send('POST', `/hr/grades/${g.id}/move?direction=down`)
                          }
                        >
                          ↓
                        </button>
                        <button type="button" className={small} onClick={() => onEdit(g)}>
                          {tp('edit')}
                        </button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FormButtons({
  busy,
  error,
  onClose,
  onSave,
  disabled = false,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  disabled?: boolean;
}) {
  const tp = useTranslations('people');
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" className={primary} disabled={busy || disabled} onClick={onSave}>
          {tp('save')}
        </button>
        <button type="button" className={small} onClick={onClose}>
          {tp('cancel')}
        </button>
      </div>
    </>
  );
}

function DepartmentForm({
  row,
  departments,
  people,
  stores,
  onClose,
}: {
  row: DepartmentRow | null;
  departments: DepartmentRow[];
  people: EmployeeRow[];
  stores: StoreRef[];
  onClose: () => void;
}) {
  const t = useTranslations('hr1');
  const tp = useTranslations('people');
  const locale = useLocale();
  const save = useSave(onClose);
  const [form, setForm] = useState({
    code: row?.code ?? '',
    nameEn: row?.nameEn ?? '',
    nameAr: row?.nameAr ?? '',
    parentId: row?.parentId ?? '',
    headEmployeeId: row?.head?.id ?? '',
    costStoreId: row?.costStore?.id ?? '',
    sort: String(row?.sort ?? 0),
    isActive: row?.isActive ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  function submit() {
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      parentId: form.parentId || null,
      headEmployeeId: form.headEmployeeId || null,
      costStoreId: form.costStoreId || null,
      sort: Number(form.sort) || 0,
      isActive: form.isActive,
    };
    void (row
      ? save.send('PATCH', `/hr/departments/${row.id}`, body)
      : save.send('POST', '/hr/departments', { ...body, code: form.code }));
  }
  return (
    <SidePanel title={row ? t('org.editDepartment') : tp('addDepartment')} onClose={onClose}>
      <div className="space-y-3">
        {!row && (
          <label className="block text-caption">
            {tp('code')}
            <input
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
              dir="ltr"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {tp('nameEn')}
          <input
            value={form.nameEn}
            onChange={(e) => set({ nameEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('nameAr')}
          <input
            value={form.nameAr}
            onChange={(e) => set({ nameAr: e.target.value })}
            dir="rtl"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('parent')}
          <select
            value={form.parentId}
            onChange={(e) => set({ parentId: e.target.value })}
            className={field}
          >
            <option value="">{tp('topLevel')}</option>
            {departmentOptions(departments)
              .filter(({ d }) => d.id !== row?.id)
              .map(({ d, depth }) => (
                <option key={d.id} value={d.id}>
                  {'  '.repeat(depth)}
                  {name(d)}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('head')}
          <select
            value={form.headEmployeeId}
            onChange={(e) => set({ headEmployeeId: e.target.value })}
            className={field}
          >
            <option value="">{tp('noHead')}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {employeeName(p, locale)} ({p.code})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('costStore')}
          <select
            value={form.costStoreId}
            onChange={(e) => set({ costStoreId: e.target.value })}
            className={field}
          >
            <option value="">{tp('companyWide')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('order')}
          <input
            value={form.sort}
            onChange={(e) => set({ sort: e.target.value })}
            inputMode="numeric"
            dir="ltr"
            className={field}
          />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
          />
          {tp('active')}
        </label>
      </div>
      <FormButtons busy={save.busy} error={save.error} onClose={onClose} onSave={submit} />
    </SidePanel>
  );
}

function PositionForm({
  row,
  departmentId,
  departments,
  grades,
  onClose,
}: {
  row: PositionRow | null;
  departmentId?: string;
  departments: DepartmentRow[];
  grades: GradeRow[];
  onClose: () => void;
}) {
  const t = useTranslations('hr1');
  const tp = useTranslations('people');
  const locale = useLocale();
  const save = useSave(onClose);
  const [form, setForm] = useState({
    code: row?.code ?? '',
    titleEn: row?.titleEn ?? '',
    titleAr: row?.titleAr ?? '',
    departmentId: row?.departmentId ?? departmentId ?? '',
    minGradeId: row?.minGradeId ?? '',
    maxGradeId: row?.maxGradeId ?? '',
    planned: String(row?.headcountPlanned ?? 0),
    leave: row?.annualLeaveDays == null ? '' : String(row.annualLeaveDays),
    isActive: row?.isActive ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  function submit() {
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
    void (row
      ? save.send('PATCH', `/hr/positions/${row.id}`, body)
      : save.send('POST', '/hr/positions', { ...body, code: form.code }));
  }
  const gradeSelect = (key: 'minGradeId' | 'maxGradeId', label: string) => (
    <label className="block text-caption">
      {label}
      <select value={form[key]} onChange={(e) => set({ [key]: e.target.value })} className={field}>
        <option value="">–</option>
        {grades.map((g) => (
          <option key={g.id} value={g.id}>
            {name(g)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <SidePanel title={row ? t('org.editPosition') : tp('addPosition')} onClose={onClose}>
      <div className="space-y-3">
        {!row && (
          <label className="block text-caption">
            {tp('code')}
            <input
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
              dir="ltr"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {tp('titleEn')}
          <input
            value={form.titleEn}
            onChange={(e) => set({ titleEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('titleAr')}
          <input
            value={form.titleAr}
            onChange={(e) => set({ titleAr: e.target.value })}
            dir="rtl"
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('department')}
          <select
            value={form.departmentId}
            onChange={(e) => set({ departmentId: e.target.value })}
            className={field}
          >
            <option value="">–</option>
            {departmentOptions(departments).map(({ d, depth }) => (
              <option key={d.id} value={d.id}>
                {'  '.repeat(depth)}
                {name(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {gradeSelect('minGradeId', tp('minGrade'))}
          {gradeSelect('maxGradeId', tp('maxGrade'))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-caption">
            {tp('planned')}
            <input
              value={form.planned}
              onChange={(e) => set({ planned: e.target.value })}
              inputMode="numeric"
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption">
            {tp('annualLeaveDays')}
            <input
              value={form.leave}
              onChange={(e) => set({ leave: e.target.value })}
              inputMode="numeric"
              dir="ltr"
              className={field}
            />
          </label>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
          />
          {tp('active')}
        </label>
      </div>
      <FormButtons
        busy={save.busy}
        error={save.error}
        onClose={onClose}
        onSave={submit}
        disabled={!form.departmentId}
      />
    </SidePanel>
  );
}

function GradeForm({
  row,
  grades,
  onClose,
}: {
  row: GradeRow | null;
  grades: GradeRow[];
  onClose: () => void;
}) {
  const t = useTranslations('hr1');
  const tp = useTranslations('people');
  const save = useSave(onClose);
  const egp = (p: number | null) => (p === null ? '' : formatEgp(p).replace(/,/g, ''));
  const top = grades.reduce((m, g) => Math.max(m, g.rank), 0);
  const [form, setForm] = useState({
    code: row?.code ?? '',
    nameEn: row?.nameEn ?? '',
    nameAr: row?.nameAr ?? '',
    rank: String(row?.rank ?? top + 1),
    min: row ? egp(row.bandMinPiastres) : '',
    max: row ? egp(row.bandMaxPiastres) : '',
    leave: row?.annualLeaveDays == null ? '' : String(row.annualLeaveDays),
    isActive: row?.isActive ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  function submit() {
    const body = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      rank: Number(form.rank),
      bandMinPiastres: form.min.trim() ? parseEgp(form.min) : null,
      bandMaxPiastres: form.max.trim() ? parseEgp(form.max) : null,
      annualLeaveDays: form.leave.trim() ? Number(form.leave) : null,
      isActive: form.isActive,
    };
    void (row
      ? save.send('PATCH', `/hr/grades/${row.id}`, body)
      : save.send('POST', '/hr/grades', { ...body, code: form.code }));
  }
  const input = (key: keyof typeof form, label: string, mode: 'numeric' | 'decimal') => (
    <label className="block text-caption">
      {label}
      <input
        value={String(form[key])}
        onChange={(e) => set({ [key]: e.target.value })}
        inputMode={mode}
        dir="ltr"
        className={field}
      />
    </label>
  );
  return (
    <SidePanel title={row ? t('org.editGrade') : tp('addGrade')} onClose={onClose}>
      <div className="space-y-3">
        {!row && (
          <label className="block text-caption">
            {tp('code')}
            <input
              value={form.code}
              onChange={(e) => set({ code: e.target.value })}
              dir="ltr"
              className={field}
            />
          </label>
        )}
        <label className="block text-caption">
          {tp('nameEn')}
          <input
            value={form.nameEn}
            onChange={(e) => set({ nameEn: e.target.value })}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('nameAr')}
          <input
            value={form.nameAr}
            onChange={(e) => set({ nameAr: e.target.value })}
            dir="rtl"
            className={field}
          />
        </label>
        {input('rank', tp('rank'), 'numeric')}
        <div className="grid grid-cols-2 gap-3">
          {input('min', tp('bandMin'), 'decimal')}
          {input('max', tp('bandMax'), 'decimal')}
        </div>
        {input('leave', tp('annualLeaveDays'), 'numeric')}
        <label className="flex min-h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
          />
          {tp('active')}
        </label>
      </div>
      <FormButtons busy={save.busy} error={save.error} onClose={onClose} onSave={submit} />
    </SidePanel>
  );
}
