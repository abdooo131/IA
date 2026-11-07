import { getLocale, getTranslations } from 'next-intl/server';
import { CountReviewButtons } from '@/components/admin/CountReviewButtons';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { title } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

interface AdminCount {
  id: string;
  status: 'submitted' | 'approved' | 'rejected' | 'stale';
  createdAt: string;
  darkStore: { nameEn: string; nameAr: string };
  bin: { code: string };
  submittedBy: string;
  lines: {
    sku: string;
    titleEn: string;
    titleAr: string;
    expectedQty: number;
    countedQty: number;
  }[];
}

export default async function AdminCountsPage() {
  const [counts, t, locale] = await Promise.all([
    apiGet<AdminCount[]>('/admin/stock-counts'),
    getTranslations('admin.counts'),
    getLocale(),
  ]);
  const pending = counts.filter((c) => c.status === 'submitted');
  const reviewed = counts.filter((c) => c.status !== 'submitted').slice(0, 20);
  const th = 'px-2 py-1 text-start text-caption text-text-muted';

  const card = (c: AdminCount, actions: boolean) => (
    <li key={c.id} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-bold">
          {localized(c.darkStore, locale)} · {t('bin', { bin: c.bin.code })}
        </p>
        <span className="rounded-pill border border-line px-2.5 py-0.5 text-caption">
          {t(`statuses.${c.status}`)}
        </span>
      </div>
      <p className="text-caption text-text-muted">
        {t('by', { name: c.submittedBy })} ·{' '}
        <span className="ltr-iso">
          {new Date(c.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}
        </span>
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('product')}</th>
              <th className={`${th} text-end`}>{t('expected')}</th>
              <th className={`${th} text-end`}>{t('counted')}</th>
              <th className={`${th} text-end`}>{t('diff')}</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l) => {
              const diff = l.countedQty - l.expectedQty;
              return (
                <tr key={l.sku} className={diff !== 0 ? 'font-bold' : 'text-text-muted'}>
                  <td className="px-2 py-1">
                    <span className="ltr-iso">{l.sku}</span> {title(l, locale)}
                  </td>
                  <td className="ltr-iso px-2 py-1 text-end">{l.expectedQty}</td>
                  <td className="ltr-iso px-2 py-1 text-end">{l.countedQty}</td>
                  <td className="ltr-iso px-2 py-1 text-end">{diff > 0 ? `+${diff}` : diff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {actions && <CountReviewButtons id={c.id} />}
    </li>
  );

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <h2 className="mt-6 text-h3">{t('pending')}</h2>
      {pending.length === 0 ? (
        <p className="mt-2 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-3 space-y-3">{pending.map((c) => card(c, true))}</ul>
      )}
      {reviewed.length > 0 && (
        <>
          <h2 className="mt-8 text-h3">{t('history')}</h2>
          <ul className="mt-3 space-y-3">{reviewed.map((c) => card(c, false))}</ul>
        </>
      )}
    </>
  );
}
