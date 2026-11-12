'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { apiGetClient, apiSend } from '@/lib/api-client';
import type {
  AreaSearchRow,
  EngineAnswer,
  GeoOverview,
  GeoSuggestion,
  ImportStatus,
} from '@/lib/geo-types';

const field =
  'block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const button =
  'h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const card = 'mt-6 rounded-lg border border-line bg-surface p-4';
const LEVELS = ['1', '2', '3', '4', '5'] as const;

/** An area's name in the page language; map areas may have only one of the two. */
function areaName(a: { nameEn: string; nameAr: string }, locale: string) {
  return locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn || a.nameAr;
}

/** The area map admin page: its size, the OpenStreetMap import, a test box and names. */
export function AddressMapManager({
  overview,
  suggestions,
}: {
  overview: GeoOverview;
  suggestions: GeoSuggestion[];
}) {
  const t = useTranslations('geo');
  const placed = overview.placedByMethod;
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {LEVELS.map((l) => (
          <StatCard
            key={l}
            label={t(`levels.${l}`)}
            value={String(overview.areasByLevel[l] ?? 0)}
          />
        ))}
      </div>
      <p className="mt-3 text-body-sm text-text-muted">
        {t('placed', {
          engine: placed.engine ?? 0,
          google: placed.google ?? 0,
        })}
      </p>
      <ImportPanel initial={overview.import} />
      <TryAddress />
      <Suggestions rows={suggestions} />
      <AddName />
    </>
  );
}

function ImportPanel({ initial }: { initial: ImportStatus }) {
  const t = useTranslations('geo');
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  // While an import runs, ask for its progress (this also keeps a sleeping server awake).
  useEffect(() => {
    if (!status.running) return;
    const timer = setInterval(async () => {
      const result = await apiGetClient<GeoOverview>('/admin/geo');
      if (!result.ok) return;
      setStatus(result.data.import);
      if (!result.data.import.running) router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [status.running, router]);

  async function start(kind: 'places' | 'streets') {
    setError(null);
    const result = await apiSend<ImportStatus>('POST', '/admin/geo/import', { kind });
    if (!result.ok) return setError(t(result.error === 'import_running' ? 'import.busy' : 'error'));
    setStatus(result.data);
  }

  return (
    <section className={card}>
      <h2 className="text-h3">{t('import.title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('import.intro')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={status.running}
          onClick={() => void start('places')}
        >
          {t('import.places')}
        </button>
        <button
          type="button"
          className={button}
          disabled={status.running}
          onClick={() => void start('streets')}
        >
          {t('import.streets')}
        </button>
      </div>
      {status.kind && (
        <p role="status" className="mt-3 text-body-sm">
          {status.running
            ? t('import.running', {
                kind: t(`import.kinds.${status.kind}`),
                done: status.done,
                total: status.total,
                saved: status.saved,
              })
            : t('import.finished', {
                kind: t(`import.kinds.${status.kind}`),
                found: status.found,
                saved: status.saved,
              })}
        </p>
      )}
      {status.failed.length > 0 && (
        <p className="mt-1 text-body-sm text-danger">
          {t('import.failed', { names: status.failed.join(', ') })}
        </p>
      )}
      {(status.error || error) && (
        <p className="mt-1 text-body-sm text-danger">{error ?? t('import.error')}</p>
      )}
    </section>
  );
}

function TryAddress() {
  const t = useTranslations('geo');
  const locale = useLocale();
  const [address, setAddress] = useState('');
  const [answer, setAnswer] = useState<EngineAnswer | null>(null);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    const result = await apiSend<EngineAnswer>('POST', '/admin/geo/resolve', { address });
    if (!result.ok) return setError(true);
    setAnswer(result.data);
  }

  return (
    <section className={card}>
      <h2 className="text-h3">{t('try.title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('try.intro')}</p>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => void submit(e)}>
        <input
          className={`${field} max-w-xl flex-1`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={t('try.placeholder')}
          aria-label={t('try.title')}
          dir="auto"
        />
        <button type="submit" className={primary} disabled={address.trim().length < 2}>
          {t('try.check')}
        </button>
      </form>
      {error && <p className="mt-2 text-body-sm text-danger">{t('error')}</p>}
      {answer && (
        <div className="mt-3">
          <p className="text-body-sm font-bold">
            {answer.status === 'unsure'
              ? t('try.unsure', { reason: t(`try.reasons.${answer.reason}`) })
              : t(`try.${answer.status}`)}
          </p>
          {answer.chain.length > 0 && (
            <ol className="mt-2 flex flex-wrap items-center gap-1 text-body-sm">
              {answer.chain.map((step, i) => (
                <li key={step.id} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden="true">›</span>}
                  <span className="rounded-pill border border-line px-2 py-0.5">
                    {areaName(step, locale)}
                    <span className="ms-1 text-caption text-text-muted">
                      {t(`levels.${step.level}`)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {answer.matched.length > 0 && (
            <p className="mt-1 text-caption text-text-muted">
              {t('try.matched', { words: answer.matched.join(', ') })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Suggestions({ rows }: { rows: GeoSuggestion[] }) {
  const t = useTranslations('geo');
  const locale = useLocale();
  const router = useRouter();
  const [phrases, setPhrases] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function decide(row: GeoSuggestion, approve: boolean) {
    setBusy(true);
    setError(false);
    const phrase = phrases[row.id]?.trim();
    const result = await apiSend('POST', `/admin/geo/suggestions/${row.id}`, {
      approve,
      ...(approve && phrase && phrase !== row.phrase ? { phrase } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(true);
    router.refresh();
  }

  return (
    <section className={card}>
      <h2 className="text-h3">{t('suggestions.title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('suggestions.intro')}</p>
      {error && <p className="mt-2 text-body-sm text-danger">{t('error')}</p>}
      {rows.length === 0 ? (
        <p className="mt-3 text-body-sm text-text-muted">{t('suggestions.none')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-end gap-3 py-3">
              <div className="min-w-0 flex-1">
                <input
                  className={field}
                  value={phrases[row.id] ?? row.phrase}
                  onChange={(e) => setPhrases({ ...phrases, [row.id]: e.target.value })}
                  aria-label={t('suggestions.phrase')}
                  dir="auto"
                />
                <p className="mt-1 text-caption text-text-muted">
                  {t('suggestions.meta', {
                    area: areaName(row.area, locale),
                    level: t(`levels.${row.area.level}`),
                    seen: row.seen,
                  })}
                </p>
                <p className="text-caption text-text-muted" dir="auto">
                  {row.sampleAddress}
                </p>
              </div>
              <button
                type="button"
                className={primary}
                disabled={busy}
                onClick={() => void decide(row, true)}
              >
                {t('suggestions.approve')}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void decide(row, false)}
              >
                {t('suggestions.reject')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddName() {
  const t = useTranslations('geo');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [areas, setAreas] = useState<AreaSearchRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const result = await apiGetClient<AreaSearchRow[]>(
      `/admin/geo/areas?q=${encodeURIComponent(query)}`,
    );
    if (!result.ok) return setMessage({ text: t('error'), error: true });
    setAreas(result.data);
  }

  async function add(area: AreaSearchRow) {
    const name = names[area.id]?.trim() ?? '';
    const result = await apiSend<{ name: string }>('POST', `/admin/geo/areas/${area.id}/names`, {
      name,
    });
    if (!result.ok) return setMessage({ text: t('error'), error: true });
    setNames({ ...names, [area.id]: '' });
    setAreas(
      (areas ?? []).map((a) =>
        a.id === area.id ? { ...a, aliases: [...a.aliases, result.data.name] } : a,
      ),
    );
    setMessage({ text: t('names.added', { name: result.data.name }), error: false });
  }

  return (
    <section className={card}>
      <h2 className="text-h3">{t('names.title')}</h2>
      <p className="mt-1 text-body-sm text-text-muted">{t('names.intro')}</p>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => void search(e)}>
        <input
          className={`${field} max-w-sm flex-1`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('names.search')}
          aria-label={t('names.search')}
          dir="auto"
        />
        <button type="submit" className={button} disabled={query.trim().length < 2}>
          {t('names.find')}
        </button>
      </form>
      {message && (
        <p
          role="status"
          className={`mt-2 text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}
      {areas && areas.length === 0 && (
        <p className="mt-3 text-body-sm text-text-muted">{t('names.noAreas')}</p>
      )}
      {areas && areas.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {areas.map((area) => (
            <li key={area.id} className="flex flex-wrap items-end gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-bold">
                  {areaName(area, locale)}
                  <span className="ms-2 text-caption text-text-muted">
                    {t(`levels.${area.level}`)}
                    {area.parentEn ? ` · ${area.parentEn}` : ''}
                  </span>
                </p>
                <p className="text-caption text-text-muted" dir="auto">
                  {area.aliases.join(' · ')}
                </p>
              </div>
              <input
                className={`${field} max-w-xs`}
                value={names[area.id] ?? ''}
                onChange={(e) => setNames({ ...names, [area.id]: e.target.value })}
                placeholder={t('names.newName')}
                aria-label={t('names.newName')}
                dir="auto"
              />
              <button
                type="button"
                className={primary}
                disabled={(names[area.id]?.trim().length ?? 0) < 2}
                onClick={() => void add(area)}
              >
                {t('names.add')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
