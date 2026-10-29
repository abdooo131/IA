import { getLocale, getTranslations } from 'next-intl/server';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';

interface HistoryRow {
  id: string;
  at: string;
  action: string;
  actor: { name: string; role: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const show = (v: unknown) => (v === null || v === undefined ? '' : String(v));
/** Plain values only: lists and internal ids mean nothing to a reader. */
const readable = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v !== 'object' && !/^c[a-z0-9]{20,}$/.test(String(v)) && String(v).length <= 80);

/** Who changed this record, when, and what changed: the record's own audit trail. */
export async function RecordHistory({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const [rows, t, ta, locale] = await Promise.all([
    apiGet<HistoryRow[]>(`/history/${entityType}/${entityId}`).catch(() => [] as HistoryRow[]),
    getTranslations('workflow'),
    getTranslations('admin.audit'),
    getLocale(),
  ]);
  return (
    <section
      className="mt-6 max-w-3xl rounded-lg border border-line bg-surface p-4"
      aria-labelledby="history"
    >
      <h2 id="history" className="text-h3">
        {t('history')}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body-sm text-text-muted">{t('noHistory')}</p>
      ) : (
        <ol className="mt-3 space-y-3 border-s-2 border-line ps-4">
          {rows.map((r) => {
            const key = `actions.${r.action.replace(/\./g, '__')}`;
            const changes = Object.keys({ ...(r.before ?? {}), ...(r.after ?? {}) }).filter(
              (k) =>
                readable(r.before?.[k]) &&
                readable(r.after?.[k]) &&
                show(r.before?.[k]) !== show(r.after?.[k]),
            );
            return (
              <li key={r.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -start-[23px] top-1.5 h-3 w-3 rounded-full bg-primary"
                />
                <p className="text-body-sm font-bold">{ta.has(key) ? ta(key) : r.action}</p>
                <p className="text-caption text-text-muted">
                  <span className="ltr-iso">{formatCairoDateTime(r.at, locale)}</span>
                  {' · '}
                  {r.actor ? r.actor.name : t('system')}
                </p>
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-caption">
                    {changes.slice(0, 8).map((k) => (
                      <li key={k} className="ltr-iso break-all">
                        {k}: {show(r.before?.[k]) || '–'} → {show(r.after?.[k]) || '–'}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
