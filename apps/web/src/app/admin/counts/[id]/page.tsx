import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { CountReviewButtons } from '@/components/admin/CountReviewButtons';
import { DocumentFrame } from '@/components/odoo/DocumentFrame';
import { localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { formatCairoDateTime } from '@/lib/format';
import { title } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

interface CountDoc {
  row: {
    id: string;
    status: 'submitted' | 'approved' | 'rejected' | 'stale';
    createdAt: string;
    reviewedAt: string | null;
    reviewNote: string | null;
    darkStore: { id: string; code: string; nameEn: string; nameAr: string };
    bin: { id: string; code: string; type: string };
    submittedBy: string;
    reviewedBy: string | null;
    lines: {
      skuId: string;
      sku: string;
      titleEn: string;
      titleAr: string;
      expectedQty: number;
      countedQty: number;
    }[];
  };
  smart: DocSmartButton[];
}

/**
 * One stock count as a document page (UX phase C step 2): status bar, approve or reject while
 * it waits (inventory manage, as before), smart buttons (the store's counts and stock, lines,
 * differences), the bin's lines with the system's and the counted units, and the chatter.
 */
export default async function AdminCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile, t, ta, td, locale] = await Promise.all([
    apiGet<CountDoc>(`/admin/stock-counts/${encodeURIComponent(id)}`),
    getMyProfile(),
    getTranslations('admin.counts'),
    getTranslations('apps'),
    getTranslations('documents'),
    getLocale(),
  ]);
  const c = doc.row;
  const th = 'px-3 py-2 text-label uppercase text-text-muted';
  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{value}</dd>
    </div>
  );
  return (
    <DocumentFrame
      root={{ label: ta('names.inventory'), href: '/admin/stock' }}
      list={{ label: ta('pages.counts'), href: '/admin/counts' }}
      id={c.id}
      number={`${c.darkStore.code} · ${c.bin.code}`}
      title={t('bin', { bin: c.bin.code })}
      status={c.status}
      statusLabel={t(`statuses.${c.status}`)}
      flow="count"
      actions={
        c.status === 'submitted' && canDo(profile, 'inventory', 'manage') ? (
          <CountReviewButtons id={c.id} />
        ) : undefined
      }
      smart={doc.smart}
      entityType="stock_count"
      canWrite={canDo(profile, 'inventory', 'use')}
    >
      <section className="rounded-lg border border-line bg-surface p-4" aria-label={td('details')}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {field(t('fields.store'), localized(c.darkStore, locale))}
          {field(t('fields.bin'), <span className="ltr-iso">{c.bin.code}</span>)}
          {field(
            t('fields.counted'),
            <>
              {t('by', { name: c.submittedBy })} ·{' '}
              <span className="ltr-iso">{formatCairoDateTime(c.createdAt, locale)}</span>
            </>,
          )}
          {c.reviewedBy &&
            field(
              t('fields.reviewed'),
              <>
                {c.reviewedBy}
                {c.reviewedAt && (
                  <>
                    {' · '}
                    <span className="ltr-iso">{formatCairoDateTime(c.reviewedAt, locale)}</span>
                  </>
                )}
              </>,
            )}
          {c.reviewNote && field(t('fields.note'), c.reviewNote)}
        </dl>
        {c.status === 'stale' && (
          <p className="mt-3 text-body-sm text-text-muted">{t('staleHint')}</p>
        )}
      </section>

      <section
        id="lines"
        className="scroll-mt-20 overflow-x-auto rounded-lg border border-line bg-surface"
        aria-label={td('lines')}
      >
        <table className="w-full min-w-[420px] text-body-sm">
          <thead className="border-b border-line bg-surface-raised">
            <tr>
              <th className={`${th} text-start`}>{t('product')}</th>
              <th className={`${th} text-end`}>{t('expected')}</th>
              <th className={`${th} text-end`}>{t('counted')}</th>
              <th className={`${th} text-end`}>{t('diff')}</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => {
              const diff = l.countedQty - l.expectedQty;
              return (
                <tr
                  key={l.skuId}
                  className={`border-b border-line last:border-0 ${diff !== 0 ? 'font-bold' : 'text-text-muted'}`}
                >
                  <td className="px-3 py-2">
                    <span className="ltr-iso">{l.sku}</span> {title(l, locale)}
                  </td>
                  <td className="ltr-iso px-3 py-2 text-end">{l.expectedQty}</td>
                  <td className="ltr-iso px-3 py-2 text-end">{l.countedQty}</td>
                  <td className="ltr-iso px-3 py-2 text-end">{diff > 0 ? `+${diff}` : diff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </DocumentFrame>
  );
}
