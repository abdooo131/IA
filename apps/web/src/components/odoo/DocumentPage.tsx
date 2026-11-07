import { canDo, DOC_LISTS, type DocDescriptor, type DocField } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { StatusBar } from '@/components/workflow/StatusBar';
import { getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { getCurrentUser } from '@/lib/server-session';
import { WORKFLOWS, type WorkflowName } from '@/lib/workflows';
import { Chatter } from './Chatter';
import { ListCrumb, RecordNav } from './RecordNav';

// The Odoo style document page (form view): breadcrumbs back to the list the person came
// from, previous and next record, the status bar, the document's action buttons, smart
// buttons with counts of related records, its fields and lines, and the chatter (notes,
// activities, attachments and the change history) beside it, below it on phones.

function Value({ field, locale }: { field: DocField; locale: string }) {
  const v = field.value;
  if (v === null || v === '') return <span className="text-text-muted">–</span>;
  switch (field.kind) {
    case 'money': {
      const n = Number(v);
      return (
        <span className={`ltr-iso font-bold ${n < 0 ? 'text-danger' : ''}`}>
          {formatEgp(n)} EGP
        </span>
      );
    }
    case 'date':
      return <span className="ltr-iso">{isoToDayFirst(String(v).slice(0, 10))}</span>;
    case 'datetime':
      return <span className="ltr-iso">{formatCairoDateTime(String(v), locale)}</span>;
    case 'percent':
      return <span className="ltr-iso">{String(v)}%</span>;
    case 'ltr':
      return <span className="ltr-iso break-all">{String(v)}</span>;
    case 'multiline':
      return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
    default:
      return <span className="break-words">{String(v)}</span>;
  }
}

export async function DocumentPage({
  doc,
  actions,
  children,
  showFields = true,
}: {
  doc: DocDescriptor;
  /** The document's action buttons (approve, mark paid...) */
  actions?: ReactNode;
  /** The document's own content under its fields (an invoice, a cheque's register) */
  children?: ReactNode;
  showFields?: boolean;
}) {
  const [t, tw, ta, tf, locale, profile, me] = await Promise.all([
    getTranslations('documents'),
    getTranslations('workflow'),
    getTranslations('apps'),
    getTranslations('finance'),
    getLocale(),
    getMyProfile(),
    getCurrentUser(),
  ]);
  const list = DOC_LISTS[doc.type];
  const canWrite = canDo(profile, 'accounting', 'use');
  const stateLabel = (s: string) => (tw.has(`states.${s}`) ? tw(`states.${s}`) : s);
  const fieldLabel = (k: string) => (t.has(`fields.${k}`) ? t(`fields.${k}`) : k);
  const fieldValue = (f: DocField): DocField =>
    f.key === 'kind' && typeof f.value === 'string' && tf.has(`kinds.${f.value}`)
      ? { ...f, value: tf(`kinds.${f.value}`) }
      : f.kind === 'status' && typeof f.value === 'string'
        ? { ...f, value: stateLabel(f.value) }
        : f;
  const flow = doc.flow && doc.flow in WORKFLOWS ? (doc.flow as WorkflowName) : null;

  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t('breadcrumbs')} className="min-w-0 text-body-sm">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/finance" className="text-link hover:underline">
                {ta('names.accounting')}
              </Link>
            </li>
            <li aria-hidden className="text-text-muted">
              /
            </li>
            <li>
              <ListCrumb href={list.href} label={t(`lists.${list.list}`)} id={doc.id} />
            </li>
            <li aria-hidden className="text-text-muted">
              /
            </li>
            <li aria-current="page" className="ltr-iso font-bold">
              {doc.number}
            </li>
          </ol>
        </nav>
        <RecordNav id={doc.id} />
      </div>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h2">
            <span className="ltr-iso">{doc.number}</span>
          </h1>
          <p className="mt-0.5 break-words text-body text-text-muted">{doc.title}</p>
        </div>
        {!flow && (
          <span className="rounded-pill border border-line px-3 py-1 text-caption font-bold">
            {stateLabel(doc.status)}
          </span>
        )}
      </header>

      {flow && <StatusBar flow={flow} status={doc.status} />}

      {actions && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          {actions}
        </div>
      )}

      {doc.smart.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 print:hidden" aria-label={t('related')}>
          {doc.smart.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="flex min-h-12 min-w-[120px] flex-col justify-center rounded-md border border-line bg-surface px-3 py-1.5 hover:border-primary hover:bg-surface-raised"
              >
                <span className="ltr-iso max-w-[220px] truncate text-body font-bold text-link">
                  {s.count ?? s.value}
                </span>
                <span className="text-caption text-text-muted">{t(`smart.${s.key}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {showFields && doc.fields.length > 0 && (
            <section
              className="rounded-lg border border-line bg-surface p-4"
              aria-label={t('details')}
            >
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {doc.fields.map((raw) => {
                  const f = fieldValue(raw);
                  return (
                    <div
                      key={f.key}
                      className={`min-w-0 ${f.kind === 'multiline' ? 'sm:col-span-2' : ''}`}
                    >
                      <dt className="text-caption text-text-muted">{fieldLabel(f.key)}</dt>
                      <dd className="text-body-sm">
                        {f.href ? (
                          <Link href={f.href} className="text-link hover:underline">
                            <Value field={f} locale={locale} />
                          </Link>
                        ) : (
                          <Value field={f} locale={locale} />
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          )}

          {doc.lines && doc.lines.rows.length > 0 && (
            <section
              id="lines"
              className="overflow-x-auto rounded-lg border border-line bg-surface"
              aria-label={t('lines')}
            >
              <table className="w-full text-body-sm">
                <thead className="border-b border-line bg-surface-raised">
                  <tr>
                    {doc.lines.columns.map((c) => (
                      <th
                        key={c.key}
                        className={`whitespace-nowrap px-3 py-2 text-label uppercase text-text-muted ${c.kind === 'money' ? 'text-end' : 'text-start'}`}
                      >
                        {fieldLabel(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.rows.map((r, i) => (
                    <tr key={String(r.id ?? i)} className="border-b border-line last:border-0">
                      {doc.lines!.columns.map((c) => {
                        const raw =
                          c.key === 'account' && locale === 'ar' && r.accountAr
                            ? r.accountAr
                            : r[c.key];
                        return (
                          <td
                            key={c.key}
                            className={`px-3 py-2 ${c.kind === 'money' ? 'text-end' : ''}`}
                          >
                            {c.key === 'entry' && r.id ? (
                              <Link href={`/finance/journal/${r.id}`} className="ltr-iso text-link">
                                {String(raw)}
                              </Link>
                            ) : (
                              <Value
                                field={{ key: c.key, value: raw ?? null, kind: c.kind }}
                                locale={locale}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {doc.lines.columns.some((c) => c.kind === 'money') && (
                  <tfoot className="border-t-2 border-line bg-surface-raised font-bold">
                    <tr>
                      {doc.lines.columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={`px-3 py-2 ${c.kind === 'money' ? 'text-end' : ''}`}
                        >
                          {c.kind === 'money' ? (
                            <span className="ltr-iso">
                              {formatEgp(
                                doc.lines!.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0),
                              )}
                            </span>
                          ) : i === 0 ? (
                            t('total')
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </section>
          )}

          {children}
        </div>

        <aside className="min-w-0 space-y-4 print:hidden" aria-label={t('chatter.title')}>
          <Chatter
            entityType={doc.entityType}
            entityId={doc.id}
            canWrite={canWrite}
            meId={me?.id ?? ''}
          />
          <section id="attachments" aria-labelledby={`att-${doc.id}`}>
            <h3 id={`att-${doc.id}`} className="text-label uppercase text-text-muted">
              {t('chatter.attachments')}
            </h3>
            {doc.attachments.length === 0 ? (
              <p className="mt-1 text-body-sm text-text-muted">{t('chatter.noAttachments')}</p>
            ) : (
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {doc.attachments.map((a) => (
                  <li key={a.photoId}>
                    <a
                      href={`/api/photos/${a.photoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block"
                    >
                      <img
                        src={`/api/photos/${a.photoId}`}
                        alt={t('chatter.attachment', { by: a.by ?? '' })}
                        className="aspect-square w-full rounded-md border border-line object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <RecordHistory entityType={doc.entityType} entityId={doc.id} />
        </aside>
      </div>
    </article>
  );
}
