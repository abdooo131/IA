'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  employeeName,
  type OrgChartData,
  type OrgDepartment,
  type PersonCard,
  titleOf,
  type Vacancy,
} from '@/lib/hr-types';
import { Avatar } from './Avatar';

// The tree is drawn with nested lists and CSS connectors (logical properties, so it mirrors in
// Arabic). Wide groups of people without reports are stacked in a column to keep it narrow.
const TREE_CSS = `
.orgtree, .orgtree ul { margin: 0; padding: 0; }
.orgtree ul { display: flex; justify-content: center; padding-top: 22px; position: relative; }
.orgtree li { list-style: none; position: relative; padding: 22px 8px 0; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.orgtree li::before, .orgtree li::after { content: ''; position: absolute; top: 0; inset-inline-end: 50%; width: 50%; height: 22px; border-top: 1.5px solid var(--shiply-line); }
.orgtree li::after { inset-inline-end: auto; inset-inline-start: 50%; border-inline-start: 1.5px solid var(--shiply-line); }
.orgtree li:only-child::before, .orgtree li:only-child::after { display: none; }
.orgtree li:only-child { padding-top: 0; }
.orgtree li:first-child::before, .orgtree li:last-child::after { border: 0 none; }
.orgtree li:last-child::before { border-inline-end: 1.5px solid var(--shiply-line); border-start-end-radius: 8px; }
.orgtree li:first-child::after { border-start-start-radius: 8px; }
.orgtree ul ul::before { content: ''; position: absolute; top: 0; inset-inline-start: 50%; width: 0; height: 22px; border-inline-start: 1.5px solid var(--shiply-line); }
.orgtree > ul { padding-top: 0; }
.orgtree > ul { justify-content: safe center; }
.orgtree .stack { display: flex; flex-direction: column; align-items: center; gap: 10px; padding-top: 22px; position: relative; }
.orgtree .stack::before { content: ''; position: absolute; top: 0; bottom: 40px; inset-inline-start: 50%; border-inline-start: 1.5px solid var(--shiply-line); }
.orgtree .stack > * { position: relative; z-index: 1; }
.orgtree li > .stack.inli { padding-top: 0; }
@media print { .orgtree-wrap { overflow: visible !important; } .orgtree-zoom { zoom: 1 !important; } }
`;

interface Node {
  person: PersonCard;
  children: Node[];
  vacancies: Vacancy[];
}

function buildTree(data: OrgChartData) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const nodes = new Map<string, Node>(
    data.people.map((p) => [p.id, { person: p, children: [], vacancies: [] }]),
  );
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    const parent =
      n.person.managerId && byId.has(n.person.managerId) ? nodes.get(n.person.managerId) : null;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const loose: Vacancy[] = [];
  for (const v of data.vacancies) {
    const at = v.reportsTo ? nodes.get(v.reportsTo) : null;
    if (at) at.vacancies.push(v);
    else loose.push(v);
  }
  const rank = (n: Node) => -(n.person.grade?.rank ?? 0);
  const sort = (list: Node[]) => {
    list.sort((a, b) => rank(a) - rank(b) || a.person.nameEn.localeCompare(b.person.nameEn));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return { roots, loose, nodes };
}

const count = (n: Node): number => n.children.reduce((s, c) => s + 1 + count(c), 0);

/**
 * The organisation drawn from manager links (a person's manager is the one set on their file
 * or the head of their department chain), or grouped by department. Photos, names, titles and
 * grades; collapsible, searchable, zoomable, scrolls sideways on phones, mirrors in Arabic;
 * a card opens the person's file. Open places come from planned headcount. Exports a PNG or
 * prints.
 */
export function OrgChart({
  data,
  fileHref,
}: {
  data: OrgChartData;
  /** Where a person's card leads (null: cards are not links) */
  fileHref: string | null;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const [view, setView] = useState<'people' | 'departments'>('people');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const tree = useMemo(() => buildTree(data), [data]);
  const depthOf = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (list: Node[], d: number) => {
      for (const n of list) {
        m.set(n.person.id, d);
        walk(n.children, d + 1);
      }
    };
    walk(tree.roots, 0);
    return m;
  }, [tree]);
  // Folded nodes; by default everything below the third level is folded.
  const [folded, setFolded] = useState<Set<string>>(
    () => new Set([...depthOf.entries()].filter(([, d]) => d >= 2).map(([id]) => id)),
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The top of the tree in the middle of the screen (wide trees scroll sideways).
  const centerTop = () =>
    requestAnimationFrame(() => {
      const wrap = wrapRef.current;
      const top = tree.roots[0] && wrap?.querySelector(`[data-node="${tree.roots[0].person.id}"]`);
      if (!wrap || !top) return;
      const a = top.getBoundingClientRect();
      const b = wrap.getBoundingClientRect();
      wrap.scrollLeft += a.left + a.width / 2 - (b.left + b.width / 2);
    });
  useEffect(() => {
    centerTop();
  }, [view]); // once per view
  /** Zoom so the whole width fits the screen (never above 100%). */
  const fit = () => {
    const wrap = wrapRef.current;
    const box = canvasRef.current;
    if (!wrap || !box) return;
    const tree = box.querySelector('.orgtree > ul');
    const natural = (tree ? tree.getBoundingClientRect().width : box.scrollWidth) / zoom;
    const room = wrap.clientWidth - 32;
    setZoom(Math.max(0.4, Math.min(1, Math.floor((room / natural) * 20) / 20)));
    centerTop();
  };

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return new Set<string>();
    return new Set(
      data.people
        .filter((p) =>
          [
            p.nameEn,
            p.nameAr,
            p.titleEn,
            p.titleAr,
            p.code,
            p.department?.nameEn,
            p.department?.nameAr,
          ]
            .filter(Boolean)
            .some((s) => s!.toLowerCase().includes(q)),
        )
        .map((p) => p.id),
    );
  }, [q, data.people]);
  // A match is shown: every manager above it opens.
  const opened = useMemo(() => {
    const keep = new Set<string>();
    for (const id of matches) {
      let cur = data.people.find((p) => p.id === id)?.managerId ?? null;
      for (let i = 0; cur && i < 50; i++) {
        keep.add(cur);
        cur = data.people.find((p) => p.id === cur)?.managerId ?? null;
      }
    }
    return keep;
  }, [matches, data.people]);
  const isFolded = (id: string) => folded.has(id) && !opened.has(id);
  const toggle = (id: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function card(p: PersonCard, extra?: { reports: number; folded: boolean }) {
    const hit = matches.has(p.id);
    const inner = (
      <>
        <Avatar employeeId={p.id} photoVersion={p.photoVersion} name={p.nameEn} size="md" />
        <span className="min-w-0 text-start">
          <span className="block truncate text-body-sm font-bold" data-name>
            {employeeName(p, locale)}
          </span>
          <span className="block truncate text-caption text-text-muted" data-title>
            {titleOf(p, locale) ?? '–'}
          </span>
          {p.grade && (
            <span
              className="mt-0.5 inline-block rounded-pill bg-selected-bg px-2 text-[11px] font-bold text-link"
              data-grade
            >
              {locale === 'ar' ? p.grade.nameAr : p.grade.nameEn}
            </span>
          )}
        </span>
      </>
    );
    const cls = `flex w-56 items-center gap-2.5 rounded-md border bg-surface p-2.5 shadow-sm transition ${
      hit ? 'border-primary ring-2 ring-[var(--shiply-focus)]' : 'border-line hover:border-primary'
    }`;
    return (
      <div className="relative" data-node={p.id} data-manager={p.managerId ?? ''}>
        {fileHref ? (
          <Link href={`${fileHref}/${p.id}`} className={cls}>
            {inner}
          </Link>
        ) : (
          <div className={cls}>{inner}</div>
        )}
        {extra && extra.reports > 0 && (
          <button
            type="button"
            onClick={() => toggle(p.id)}
            aria-expanded={!extra.folded}
            aria-label={extra.folded ? t('showReports') : t('hideReports')}
            className="absolute -bottom-3 left-1/2 z-10 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center rounded-pill border border-line bg-surface px-1.5 text-caption font-bold text-link shadow-sm print:hidden"
          >
            {extra.folded ? `+${extra.reports}` : '−'}
          </button>
        )}
      </div>
    );
  }

  /** One dashed card for every open place under a manager (or a department). */
  function vacancyCard(list: Vacancy[], key: string, managerId?: string | null) {
    const open = list.reduce((sum, v) => sum + v.open, 0);
    const lines = list.map((v) => `${locale === 'ar' ? v.titleAr : v.titleEn} ×${v.open}`);
    return (
      <div
        className="flex w-56 items-center gap-2.5 rounded-md border border-dashed border-status-needs-action bg-surface p-2.5"
        data-node={`vac-${key}`}
        data-manager={managerId ?? ''}
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-status-needs-action text-h3 text-status-needs-action"
        >
          +
        </span>
        <span className="min-w-0 text-start">
          <span className="block truncate text-body-sm font-bold" data-name>
            {t('openPlaces', { count: open })}
          </span>
          <span
            className="block truncate text-caption text-text-muted"
            data-title
            title={lines.join(', ')}
          >
            {lines.join(' · ')}
          </span>
        </span>
      </div>
    );
  }

  function branch(n: Node) {
    const f = isFolded(n.person.id);
    const deep = n.children.filter((c) => c.children.length > 0 || c.vacancies.length > 0);
    const leaves = n.children.filter((c) => c.children.length === 0 && c.vacancies.length === 0);
    // People without reports (and the open places) stack in one column under their manager.
    const items: { key: string; el: ReactNode }[] = [
      ...leaves.map((c) => ({ key: c.person.id, el: card(c.person) })),
      ...(n.vacancies.length
        ? [{ key: `v-${n.person.id}`, el: vacancyCard(n.vacancies, n.person.id, n.person.id) }]
        : []),
    ];
    const reports = deep.length + items.length;
    const stack = (inli: boolean) => (
      <div className={`stack${inli ? ' inli' : ''}`}>
        {items.map((k) => (
          <div key={k.key}>{k.el}</div>
        ))}
      </div>
    );
    return (
      <li key={n.person.id}>
        {card(n.person, { reports: count(n) + n.vacancies.length, folded: f })}
        {reports > 0 &&
          !f &&
          (deep.length === 0 && items.length > 2 ? (
            stack(false)
          ) : (
            <ul>
              {deep.map((c) => branch(c))}
              {deep.length > 0 && items.length > 1 ? (
                <li key="leaves">{stack(true)}</li>
              ) : (
                items.map((k) => <li key={k.key}>{k.el}</li>)
              )}
            </ul>
          ))}
      </li>
    );
  }

  async function exportPng() {
    const box = canvasRef.current;
    if (!box) return;
    await drawPng(box, zoom, locale === 'ar');
  }

  const button =
    'inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold';
  return (
    <div>
      <style>{TREE_CSS}</style>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="tablist">
          {(['people', 'departments'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`h-9 rounded-sm px-3 text-body-sm font-bold ${
                view === v ? 'bg-selected-bg text-link' : 'text-text'
              }`}
            >
              {t(v === 'people' ? 'byManager' : 'byDepartment')}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('findPerson')}
          aria-label={t('findPerson')}
          className="h-10 min-w-[200px] flex-1 rounded-md border border-line bg-surface px-3 text-body-sm"
        />
        {view === 'people' && (
          <>
            <button
              type="button"
              className={button}
              onClick={() => {
                setFolded(new Set());
                centerTop();
              }}
            >
              {t('expandAll')}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setFolded(
                  new Set([...depthOf.entries()].filter(([, d]) => d >= 1).map(([id]) => id)),
                );
                centerTop();
              }}
            >
              {t('collapseAll')}
            </button>
            <span className="flex items-center rounded-md border border-line bg-surface">
              <button
                type="button"
                className="h-10 w-10 text-h3"
                aria-label={t('zoomOut')}
                onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
              >
                −
              </button>
              <span className="ltr-iso w-12 text-center text-caption">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="h-10 w-10 text-h3"
                aria-label={t('zoomIn')}
                onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}
              >
                +
              </button>
            </span>
            <button type="button" className={button} onClick={fit}>
              {t('fit')}
            </button>
            <button type="button" className={button} onClick={() => void exportPng()}>
              {t('exportPng')}
            </button>
          </>
        )}
        <button type="button" className={button} onClick={() => window.print()}>
          {t('print')}
        </button>
      </div>
      <p className="mt-2 text-caption text-text-muted print:hidden">
        {t('orgSummary', {
          people: data.people.length,
          open: data.vacancies.reduce((s, v) => s + v.open, 0),
        })}
        {q && <> · {t('found', { count: matches.size })}</>}
      </p>

      {view === 'people' ? (
        <div
          ref={wrapRef}
          className="orgtree-wrap mt-3 overflow-auto rounded-lg border border-line bg-bg p-4"
        >
          <div ref={canvasRef} className="orgtree-zoom inline-block min-w-full" style={{ zoom }}>
            <div className="orgtree">
              <ul>
                {tree.roots.map((n) => branch(n))}
                {tree.loose.length > 0 && <li key="loose">{vacancyCard(tree.loose, 'loose')}</li>}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <DepartmentView data={data} card={card} vacancyCard={vacancyCard} matches={matches} />
      )}
    </div>
  );
}

function DepartmentView({
  data,
  card,
  vacancyCard,
  matches,
}: {
  data: OrgChartData;
  card: (p: PersonCard) => ReactNode;
  vacancyCard: (list: Vacancy[], key: string) => ReactNode;
  matches: Set<string>;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const total = (d: OrgDepartment): number =>
    d.headcount +
    data.departments.filter((c) => c.parentId === d.id).reduce((s, c) => s + total(c), 0);
  const ids = new Set(data.departments.map((d) => d.id));
  const box = (d: OrgDepartment, depth: number) => {
    const people = data.people
      .filter((p) => p.department?.id === d.id)
      .sort(
        (a, b) =>
          Number(b.id === d.headEmployeeId) - Number(a.id === d.headEmployeeId) ||
          (b.grade?.rank ?? 0) - (a.grade?.rank ?? 0) ||
          a.nameEn.localeCompare(b.nameEn),
      );
    const head = data.people.find((p) => p.id === d.headEmployeeId);
    const subs = data.departments.filter((c) => c.parentId === d.id);
    const vac = data.vacancies.filter((v) => v.departmentId === d.id);
    const isClosed = closed.has(d.id) && !people.some((p) => matches.has(p.id));
    return (
      <section
        key={d.id}
        className={`rounded-lg border border-line ${depth === 0 ? 'bg-surface' : 'bg-bg'} p-3 sm:p-4`}
        aria-labelledby={`dep-${d.id}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id={`dep-${d.id}`} className={depth === 0 ? 'text-h3' : 'text-body font-bold'}>
              {locale === 'ar' ? d.nameAr : d.nameEn}
            </h2>
            <p className="text-caption text-text-muted">
              {head ? t('headIs', { name: employeeName(head, locale) }) : t('noHead')}
              {' · '}
              {t('headcount', { count: total(d) })}
              {vac.length > 0 && (
                <> · {t('openPlaces', { count: vac.reduce((s, v) => s + v.open, 0) })}</>
              )}
            </p>
          </div>
          <button
            type="button"
            className="h-8 rounded-md border border-line bg-surface px-2 text-caption font-bold print:hidden"
            aria-expanded={!isClosed}
            onClick={() =>
              setClosed((c) => {
                const n = new Set(c);
                if (n.has(d.id)) n.delete(d.id);
                else n.add(d.id);
                return n;
              })
            }
          >
            {isClosed ? t('show') : t('hide')}
          </button>
        </header>
        {!isClosed && (
          <>
            {(people.length > 0 || vac.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {people.map((p) => (
                  <div key={p.id}>{card(p)}</div>
                ))}
                {vac.length > 0 && <div>{vacancyCard(vac, `d-${d.id}`)}</div>}
              </div>
            )}
            {subs.length > 0 && (
              <div className={`mt-3 grid gap-3 ${depth === 0 ? 'lg:grid-cols-2' : ''}`}>
                {subs.map((s) => box(s, depth + 1))}
              </div>
            )}
          </>
        )}
      </section>
    );
  };
  const roots = data.departments.filter((d) => !d.parentId || !ids.has(d.parentId));
  const placeless = data.people.filter((p) => !p.department || !ids.has(p.department.id));
  return (
    <div className="mt-3 space-y-3">
      {roots.map((d) => box(d, 0))}
      {placeless.length > 0 && (
        <section className="rounded-lg border border-dashed border-line p-4">
          <h2 className="text-body font-bold">{t('noDepartment')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {placeless.map((p) => (
              <div key={p.id}>{card(p)}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Draws the cards and connectors that are on screen into a PNG and downloads it. */
async function drawPng(box: HTMLElement, zoom: number, rtl: boolean) {
  const origin = box.getBoundingClientRect();
  const scale = 2;
  const width = origin.width;
  const height = origin.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale) + 48;
  canvas.height = Math.ceil(height * scale) + 48;
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  ctx.fillStyle = color('--shiply-bg', 'white');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(24, 24);
  ctx.scale(scale, scale);
  const rect = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };
  const nodes = [...box.querySelectorAll<HTMLElement>('[data-node]')];
  const at = new Map(
    nodes.map((n) => [
      n.dataset.node!,
      rect(n.dataset.node!.startsWith('vac-') ? n : (n.firstElementChild ?? n)),
    ]),
  );
  // Connectors: an elbow from each manager down to each of their people on screen.
  ctx.strokeStyle = color('--shiply-line', 'silver');
  ctx.lineWidth = 1.5;
  for (const n of nodes) {
    const m = n.dataset.manager;
    const from = m ? at.get(m) : null;
    const to = at.get(n.dataset.node!);
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const mid = y1 + (y2 - y1) / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, mid);
    ctx.lineTo(x2, mid);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  const font = getComputedStyle(document.body).fontFamily;
  ctx.direction = rtl ? 'rtl' : 'ltr';
  for (const n of nodes) {
    const r = at.get(n.dataset.node!)!;
    const vacancy = n.dataset.node!.startsWith('vac-');
    ctx.fillStyle = color('--shiply-surface', 'white');
    ctx.strokeStyle = vacancy
      ? color('--shiply-status-needs-action', 'orange')
      : color('--shiply-line', 'silver');
    ctx.setLineDash(vacancy ? [4, 3] : []);
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    const img = n.querySelector('img');
    const size = 48 * zoom;
    const ax = rtl ? r.x + r.w - 10 * zoom - size : r.x + 10 * zoom;
    const ay = r.y + (r.h - size) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, ax, ay, size, size);
    else {
      const badge = n.querySelector<HTMLElement>('span[aria-hidden="true"]');
      ctx.fillStyle = badge ? getComputedStyle(badge).backgroundColor : 'silver';
      ctx.fillRect(ax, ay, size, size);
      ctx.fillStyle = badge ? getComputedStyle(badge).color : 'black';
      ctx.font = `700 ${16 * zoom}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge?.textContent ?? '', ax + size / 2, ay + size / 2 + 1);
    }
    ctx.restore();
    const tx = rtl ? ax - 10 * zoom : ax + size + 10 * zoom;
    const maxW = r.w - size - 30 * zoom;
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    const lines: [string, string, string][] = [];
    const name =
      n.querySelector('[data-name]')?.textContent ??
      n.querySelector('.font-bold')?.textContent ??
      '';
    const title = n.querySelector('[data-title]')?.textContent ?? '';
    const grade = n.querySelector('[data-grade]')?.textContent ?? '';
    lines.push([name, `700 ${14 * zoom}px ${font}`, color('--shiply-text', 'black')]);
    if (title)
      lines.push([title, `500 ${12 * zoom}px ${font}`, color('--shiply-text-muted', 'gray')]);
    if (grade) lines.push([grade, `700 ${11 * zoom}px ${font}`, color('--shiply-link', 'blue')]);
    let y = r.y + r.h / 2 - ((lines.length - 1) * 16 * zoom) / 2 + 4 * zoom;
    for (const [text, f, c] of lines) {
      ctx.font = f;
      ctx.fillStyle = c;
      ctx.fillText(text, tx, y, maxW);
      y += 16 * zoom;
    }
  }
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'org-chart.png';
  a.click();
}
