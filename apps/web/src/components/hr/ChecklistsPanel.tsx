'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import type { ChecklistTemplateRow, EmployeeChecklist } from '@/lib/hr-types';

const button =
  'inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50';

/**
 * Onboarding and offboarding checklists of one person: progress, each task with its owner and
 * due day, ticked by HR (tasks tied to a document tick themselves when it is verified).
 */
export function ChecklistsPanel({
  employeeId,
  checklists,
  templates,
  canUse,
  canManage,
}: {
  employeeId: string;
  checklists: EmployeeChecklist[];
  templates: ChecklistTemplateRow[];
  canUse: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('people');
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const title = (x: { titleEn: string; titleAr: string }) =>
    locale === 'ar' ? x.titleAr : x.titleEn;
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const fail = (code: string) =>
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function call(method: 'POST' | 'PATCH', path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const result = await apiSend(method, path, body);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    router.refresh();
  }

  const openKinds = new Set(checklists.filter((c) => c.status === 'open').map((c) => c.kind));
  const startable = templates.filter((tp) => tp.isActive && !openKinds.has(tp.kind));

  return (
    <div className="mt-4 max-w-4xl space-y-4">
      {checklists.length === 0 && (
        <p className="text-body-sm text-text-muted">{t('noChecklists')}</p>
      )}
      {checklists.map((c) => {
        const percent = c.total ? Math.round((c.done / c.total) * 100) : 100;
        return (
          <section
            key={c.id}
            className="rounded-lg border border-line bg-surface"
            aria-labelledby={`cl-${c.id}`}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-4">
              <div>
                <h2 id={`cl-${c.id}`} className="text-h3">
                  {name(c)}
                </h2>
                <p className="text-caption text-text-muted">
                  {t(`checklistKinds.${c.kind}`)} ·{' '}
                  {t('startsOn', { date: isoToDayFirst(c.startsOn) })} ·{' '}
                  {t(`checklistStatuses.${c.status}`)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="ltr-iso text-body-sm font-bold">
                  {c.done}/{c.total}
                </span>
                <div className="h-2 w-28 overflow-hidden rounded-pill bg-surface-raised">
                  <div
                    className={`h-full ${c.status === 'done' ? 'bg-status-delivered' : 'bg-primary'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                {canManage && c.status === 'open' && (
                  <button
                    type="button"
                    className={`${button} text-danger`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t('cancelChecklistConfirm')))
                        void call('POST', `/hr/employees/${employeeId}/checklists/${c.id}/cancel`);
                    }}
                  >
                    {t('cancelChecklist')}
                  </button>
                )}
              </div>
            </header>
            <ul className="divide-y divide-line">
              {c.tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={!!task.doneAt}
                    disabled={!canUse || busy || c.status === 'cancelled'}
                    aria-label={title(task)}
                    onChange={(e) =>
                      void call('PATCH', `/hr/employees/${employeeId}/checklist-tasks/${task.id}`, {
                        done: e.target.checked,
                      })
                    }
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--shiply-primary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-body-sm ${task.doneAt ? 'text-text-muted line-through' : ''}`}
                    >
                      {title(task)}
                    </p>
                    <p className="text-caption text-text-muted">
                      <span className="rounded-pill bg-surface-raised px-2">
                        {t(`owners.${task.ownerRole}`)}
                      </span>{' '}
                      {task.doneAt ? (
                        task.note === 'document_verified' ? (
                          t('doneByDocument')
                        ) : (
                          t('doneBy', { name: task.doneBy ?? '–' })
                        )
                      ) : (
                        <span className={task.overdue ? 'font-bold text-danger' : undefined}>
                          {task.overdue
                            ? t('overdue', { date: isoToDayFirst(task.dueOn) })
                            : t('due', { date: isoToDayFirst(task.dueOn) })}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {canUse && startable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-4">
          <label className="block min-w-[240px] flex-1 text-caption">
            {t('startChecklist')}
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm"
            >
              <option value="">–</option>
              {startable.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {name(tp)} ({t(`checklistKinds.${tp.kind}`)})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 font-bold text-on-primary disabled:opacity-50"
            disabled={!templateId || busy}
            onClick={() => {
              const tp = startable.find((x) => x.id === templateId);
              if (tp)
                void call('POST', `/hr/employees/${employeeId}/checklists`, {
                  kind: tp.kind,
                  templateId: tp.id,
                });
            }}
          >
            {t('start')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
