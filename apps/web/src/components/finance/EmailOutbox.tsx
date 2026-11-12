'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { EmailOutboxPage, EmailRow, EmailStatus } from '@/lib/purchasing-types';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2 align-top';
const STATUS_CLASS: Record<EmailStatus, string> = {
  pending: 'text-status-needs-action',
  sent: 'text-status-delivered',
  failed: 'text-danger',
};

/** The email outbox: what went to merchants, what waits and what failed, with a preview. */
export function EmailOutbox({ page, status }: { page: EmailOutboxPage; status: string }) {
  const t = useTranslations('purchasing.emails');
  const locale = useLocale();
  const router = useRouter();
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(row: EmailRow) {
    const result = await apiGetClient<{ subject: string; html: string }>(
      `/finance/emails/${row.id}/preview`,
    );
    if (result.ok) setPreview(result.data);
  }

  async function retry(row: EmailRow) {
    setBusy(true);
    const result = await apiSend('POST', `/finance/emails/${row.id}/retry`, {});
    setBusy(false);
    setMessage(result.ok ? t('retried') : t('retryFailed'));
    router.refresh();
  }

  const filters: ('' | EmailStatus)[] = ['', 'pending', 'sent', 'failed'];
  return (
    <div className="mt-4 space-y-4">
      {!page.configured && (
        <p role="status" className="rounded-lg border border-line bg-surface p-4 text-body-sm">
          <span className="font-bold">{t('notSetUp')}</span> {t('notSetUpHint')}
        </p>
      )}
      <nav className="flex flex-wrap gap-2" aria-label={t('filter')}>
        {filters.map((s) => (
          <a
            key={s || 'all'}
            href={s ? `/finance/emails?status=${s}` : '/finance/emails'}
            aria-current={status === s ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 text-body-sm ${
              status === s ? 'border-primary bg-selected-bg font-bold text-link' : 'border-line'
            }`}
          >
            {s ? t(`status.${s}`) : t('all')}
            {s && page.counts[s] !== undefined ? ` (${page.counts[s]})` : ''}
          </a>
        ))}
      </nav>
      {message && (
        <p role="status" className="text-body-sm text-text-muted">
          {message}
        </p>
      )}
      {page.rows.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className={th}>{t('created')}</th>
                <th className={th}>{t('kind')}</th>
                <th className={th}>{t('merchant')}</th>
                <th className={th}>{t('to')}</th>
                <th className={th}>{t('state')}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className={`${td} ltr-iso whitespace-nowrap`}>
                    {formatCairoDateTime(row.createdAt, locale)}
                  </td>
                  <td className={td}>
                    {t(`kinds.${row.kind}`)}
                    <span dir="auto" className="block text-caption text-text-muted">
                      {row.subject}
                    </span>
                    {row.attachments.map((a) => (
                      <span key={a} className="ltr-iso block text-caption text-text-muted">
                        📎 {a}
                      </span>
                    ))}
                  </td>
                  <td className={td}>{row.merchant?.name ?? ''}</td>
                  <td className={`${td} ltr-iso break-all`}>{row.toEmails.join(', ')}</td>
                  <td className={td}>
                    <span className={`font-bold ${STATUS_CLASS[row.status]}`}>
                      {t(`status.${row.status}`)}
                    </span>
                    <span className="block text-caption text-text-muted">
                      {row.status === 'sent' && row.sentAt
                        ? formatCairoDateTime(row.sentAt, locale)
                        : t('attempts', { count: row.attempts })}
                    </span>
                    {row.lastError && row.status !== 'sent' && (
                      <span className="ltr-iso block text-caption text-danger">
                        {row.lastError}
                      </span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <button
                      type="button"
                      onClick={() => void open(row)}
                      className="rounded-md border border-line px-3 py-1 text-body-sm font-bold"
                    >
                      {t('preview')}
                    </button>
                    {/* Send again only once a try failed: a pending email not tried yet
                        goes out with the next run on its own. */}
                    {(row.status === 'failed' ||
                      (row.status === 'pending' && row.attempts > 0)) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void retry(row)}
                        className="ms-2 rounded-md bg-primary px-3 py-1 text-body-sm font-bold text-on-primary disabled:opacity-50"
                      >
                        {t('retry')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview && (
        <section aria-label={t('preview')} className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3">{preview.subject}</h2>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded-md border border-line px-3 py-1 text-body-sm"
            >
              {t('closePreview')}
            </button>
          </div>
          {/* The email's own HTML, in a frame that runs no scripts. */}
          <iframe
            title={preview.subject}
            sandbox=""
            srcDoc={preview.html}
            className="mt-3 h-[640px] w-full rounded-md border border-line bg-white"
          />
        </section>
      )}
    </div>
  );
}
