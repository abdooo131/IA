import type { DocDescriptor, DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { StatusBar } from '@/components/workflow/StatusBar';
import { getCurrentUser } from '@/lib/server-session';
import type { WorkflowName } from '@/lib/workflows';
import { AddAttachments, AttachmentsSmart, AttachmentTile } from './Attachments';
import { Chatter, type ChatterNotes } from './Chatter';
import { ListCrumb, RecordNav } from './RecordNav';

// The frame of every Odoo style document page (form view), whatever the app: breadcrumbs back
// to the list the person came from (with its filters), previous and next record, the header
// and status bar, the document's action buttons, smart buttons with counts of related records,
// then the page's own content with the chatter (notes, activities, attachments and the change
// history) beside it, below it on narrower screens.

export interface DocAttachment {
  photoId: string;
  at: string;
  by: string | null;
  /** What the photo shows (pack, delivery, door, receipt); labels under documents.chatter */
  kind?: string;
  /** application/pdf for a PDF; missing means a photo */
  contentType?: string;
  fileName?: string | null;
  /** Where the file opens when it is not a photo row (a payout's proof of transfer) */
  href?: string;
}

/** Smart buttons that count the record's files: they open the files themselves. */
const FILE_BUTTONS = new Set(['receipts', 'attachments']);

export async function DocumentFrame({
  root,
  list,
  id,
  number,
  numberLtr = true,
  title,
  status,
  statusLabel,
  flow,
  actions,
  smart = [],
  attachments = [],
  attachTarget = null,
  entityType,
  canWrite,
  notes,
  asideFrom = 'lg',
  header,
  historyPath,
  children,
}: {
  /** The app's home (Accounting, Operations) */
  root: { label: string; href: string };
  /** The list the document belongs to (its filters are kept from where the person came) */
  list: { label: string; href: string };
  id: string;
  number: string;
  numberLtr?: boolean;
  title?: ReactNode;
  status: string;
  statusLabel: string;
  /** The status bar's path; without one the status shows as a pill */
  flow: WorkflowName | null;
  actions?: ReactNode;
  smart?: DocSmartButton[];
  attachments?: DocAttachment[];
  /** Where Add receipts links new files; null hides it */
  attachTarget?: DocDescriptor['attachTarget'];
  /** The audit entity type the chatter and history hang off */
  entityType: string;
  canWrite: boolean;
  /** The chatter's notes from another thread (an order's team notes) */
  notes?: ChatterNotes;
  /** From which screen width the chatter sits beside the content (xl for wide pages) */
  asideFrom?: 'lg' | 'xl';
  /** Replaces the default header (a page with its own header, like the order page) */
  header?: ReactNode;
  /** Another endpoint for the history (an employee's timeline that hides pay without salaries) */
  historyPath?: string;
  children?: ReactNode;
}) {
  const [t, me] = await Promise.all([getTranslations('documents'), getCurrentUser()]);
  const grid =
    asideFrom === 'xl'
      ? 'xl:grid-cols-[minmax(0,1fr)_340px]'
      : 'lg:grid-cols-[minmax(0,1fr)_360px]';
  const smartClass =
    'flex min-h-12 flex-col justify-center rounded-md border border-line bg-surface px-2 py-1.5 hover:border-primary hover:bg-surface-raised sm:min-w-[120px] sm:px-3';
  const attachmentLabel = (a: DocAttachment) =>
    a.kind && t.has(`chatter.photoKinds.${a.kind}`)
      ? t(`chatter.photoKinds.${a.kind}`)
      : t('chatter.attachment', { by: a.by ?? '' });
  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <nav aria-label={t('breadcrumbs')} className="min-w-0 text-body-sm">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href={root.href} className="text-link hover:underline">
                {root.label}
              </Link>
            </li>
            <li aria-hidden className="text-text-muted">
              /
            </li>
            <li>
              <ListCrumb href={list.href} label={list.label} id={id} />
            </li>
            <li aria-hidden className="text-text-muted">
              /
            </li>
            <li aria-current="page" className={`font-bold ${numberLtr ? 'ltr-iso' : ''}`}>
              {number}
            </li>
          </ol>
        </nav>
        <RecordNav id={id} />
      </div>

      {header ?? (
        <>
          <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-h2">
                <span className={numberLtr ? 'ltr-iso' : ''}>{number}</span>
              </h1>
              {title && <p className="mt-0.5 break-words text-body text-text-muted">{title}</p>}
            </div>
            {!flow && (
              <span className="rounded-pill border border-line px-3 py-1 text-caption font-bold">
                {statusLabel}
              </span>
            )}
          </header>
          {flow && <StatusBar flow={flow} status={status} />}
        </>
      )}

      {actions && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3 print:hidden">
          {actions}
        </div>
      )}

      {smart.length > 0 && (
        <ul
          className="mt-3 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap print:hidden"
          aria-label={t('related')}
        >
          {smart.map((s) => (
            <li key={s.key} className="min-w-0">
              {FILE_BUTTONS.has(s.key) && s.href === '#attachments' ? (
                <AttachmentsSmart
                  files={attachments}
                  label={t(`smart.${s.key}`)}
                  className={smartClass}
                />
              ) : (
                <Link href={s.href} className={smartClass}>
                  <span className="ltr-iso truncate text-body font-bold text-link sm:max-w-[220px]">
                    {s.count ?? s.value}
                  </span>
                  <span className="truncate text-caption text-text-muted">
                    {t(`smart.${s.key}`)}
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={`mt-4 grid gap-4 ${grid}`}>
        <div className="min-w-0 space-y-4">{children}</div>

        <aside className="min-w-0 space-y-4 print:hidden" aria-label={t('chatter.title')}>
          <Chatter
            entityType={entityType}
            entityId={id}
            canWrite={canWrite}
            meId={me?.id ?? ''}
            notes={notes}
          />
          <section id="attachments" aria-labelledby={`att-${id}`} className="scroll-mt-20">
            <h3 id={`att-${id}`} className="text-label uppercase text-text-muted">
              {t('chatter.attachments')}
            </h3>
            {attachments.length === 0 ? (
              <p className="mt-1 text-body-sm text-text-muted">{t('chatter.noAttachments')}</p>
            ) : (
              <ul className="mt-2 grid grid-cols-3 gap-2">
                {attachments.map((a) => (
                  <li key={a.photoId}>
                    <AttachmentTile file={a} label={attachmentLabel(a)} />
                    {a.kind && (
                      <span className="mt-0.5 block truncate text-caption text-text-muted">
                        {attachmentLabel(a)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && attachTarget && <AddAttachments target={attachTarget} />}
          </section>
          <RecordHistory entityType={entityType} entityId={id} path={historyPath} />
        </aside>
      </div>
    </article>
  );
}
