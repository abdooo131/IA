'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiGetClient } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';

export interface AuditRow {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { name: string; email: string; role: string } | null;
  before: unknown;
  after: unknown;
}
export interface AuditPage {
  rows: AuditRow[];
  nextCursor: string | null;
}

/** Shows only the fields that changed when both sides are objects, otherwise the raw values. */
function changes(before: unknown, after: unknown): { key: string; from: string; to: string }[] {
  const show = (v: unknown) =>
    v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) || isObj(after)) {
    const a = isObj(before) ? before : {};
    const b = isObj(after) ? after : {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => ({ key: k, from: show(a[k]), to: show(b[k]) }));
  }
  if (before === null && after === null) return [];
  return [{ key: '', from: show(before ?? ''), to: show(after ?? '') }];
}

export function AuditList({ first, query }: { first: AuditPage; query: string }) {
  const t = useTranslations('admin.audit');
  const locale = useLocale();
  const [rows, setRows] = useState(first.rows);
  const [cursor, setCursor] = useState(first.nextCursor);
  const [busy, setBusy] = useState(false);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    const params = new URLSearchParams(query);
    params.set('cursor', cursor);
    const result = await apiGetClient<AuditPage>(`/admin/audit?${params}`);
    setBusy(false);
    if (!result.ok) return;
    setRows((r) => [...r, ...result.data.rows]);
    setCursor(result.data.nextCursor);
  }

  if (rows.length === 0) return <p className="mt-6 text-body text-text-muted">{t('empty')}</p>;
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
        <table className="w-full min-w-[860px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={th}>{t('when')}</th>
              <th className={th}>{t('who')}</th>
              <th className={th}>{t('what')}</th>
              <th className={th}>{t('details')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = changes(r.before, r.after);
              return (
                <tr key={r.id} className="border-b border-line align-top last:border-0">
                  <td className="ltr-iso whitespace-nowrap px-3 py-2">
                    {formatCairoDateTime(r.at, locale)}
                  </td>
                  <td className="px-3 py-2">
                    {r.actor ? (
                      <>
                        {r.actor.name}
                        <p className="ltr-iso text-caption text-text-muted">{r.actor.email}</p>
                      </>
                    ) : (
                      <span className="text-text-muted">{t('system')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-bold">
                      {t.has(`actions.${r.action.replace(/\./g, '__')}`)
                        ? t(`actions.${r.action.replace(/\./g, '__')}`)
                        : r.action}
                    </span>
                    <p className="ltr-iso text-caption text-text-muted">
                      {t.has(`entities.${r.entityType}`)
                        ? t(`entities.${r.entityType}`)
                        : r.entityType}{' '}
                      · {r.entityId}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {diff.length > 0 && (
                      <ul className="space-y-0.5">
                        {diff.map((d) => (
                          <li key={d.key} className="ltr-iso break-all text-caption">
                            {d.key && <span className="font-bold">{d.key}: </span>}
                            <span className="text-danger line-through">{d.from}</span>{' '}
                            <span aria-hidden>→</span>{' '}
                            <span className="text-status-delivered">{d.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void more()}
          className="mt-4 h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50"
        >
          {t('loadMore')}
        </button>
      )}
    </>
  );
}
