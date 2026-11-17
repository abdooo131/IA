import { canDo, DOC_LISTS, type DocDescriptor, type DocField } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { WORKFLOWS, type WorkflowName, workflowStateLabel } from '@/lib/workflows';
import { humanise } from '@/lib/history-format';
import { DocumentFrame } from './DocumentFrame';

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
  const [t, tw, ta, tf, tr, locale, profile] = await Promise.all([
    getTranslations('documents'),
    getTranslations('workflow'),
    getTranslations('apps'),
    getTranslations('finance'),
    getTranslations('riderPay'),
    getLocale(),
    getMyProfile(),
  ]);
  const list = DOC_LISTS[doc.type];
  const canWrite = canDo(profile, 'accounting', 'use');
  const stateLabel = (s: string) => workflowStateLabel(tw, doc.flow, s);
  const fieldLabel = (k: string) => (t.has(`fields.${k}`) ? t(`fields.${k}`) : k);
  // Stored codes in words: a request's kind (loan_in), an entry's kind, a withdrawal's method.
  const isRequest = doc.type === 'finance_request';
  const kindWord = (v: string) => {
    const key = isRequest ? `approvals.kinds.${v}` : `kinds.${v}`;
    return tf.has(key) ? tf(key) : humanise(v);
  };
  const fieldValue = (f: DocField): DocField => {
    if (typeof f.value !== 'string') return f;
    if (f.key === 'kind') return { ...f, value: kindWord(f.value) };
    if (f.key === 'method' && tr.has(`methods.${f.value}`))
      return { ...f, value: tr(`methods.${f.value}`) };
    if (f.kind === 'status') return { ...f, value: stateLabel(f.value) };
    return f;
  };
  const rawKind = doc.fields.find((f) => f.key === 'kind')?.value;
  // A request without a reference is titled by its kind, in words.
  const title = isRequest && doc.title === rawKind ? kindWord(String(rawKind)) : doc.title;
  // A smart button showing a status (a petty expense's approval request) shows it in words.
  const smart = doc.smart.map((s) => {
    const v = s.value;
    if (typeof v !== 'string' || !/^[a-z][a-z_]*$/.test(v)) return s;
    if (s.key === 'request' && tf.has(`approvals.statuses.${v}`))
      return { ...s, value: tf(`approvals.statuses.${v}`) };
    return tw.has(`states.${v}`) ? { ...s, value: workflowStateLabel(tw, null, v) } : s;
  });
  const flow = doc.flow && doc.flow in WORKFLOWS ? (doc.flow as WorkflowName) : null;

  return (
    <DocumentFrame
      root={{ label: ta('names.accounting'), href: '/finance' }}
      list={{ label: t(`lists.${list.list}`), href: list.href }}
      id={doc.id}
      number={doc.number}
      title={title}
      status={doc.status}
      statusLabel={stateLabel(doc.status)}
      flow={flow}
      actions={actions}
      smart={smart}
      attachments={doc.attachments}
      attachTarget={doc.attachTarget ?? null}
      entityType={doc.entityType}
      canWrite={canWrite}
    >
      {showFields && doc.fields.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-4" aria-label={t('details')}>
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
                    <td key={c.key} className={`px-3 py-2 ${c.kind === 'money' ? 'text-end' : ''}`}>
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
    </DocumentFrame>
  );
}
