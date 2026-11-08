import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ResolveAlertButton } from '@/components/orders/ResolveAlertButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

interface AlertRow {
  id: string;
  /** Which company of the group the alert belongs to */
  company: 'shiply_now' | 'shiply';
  type: string;
  stage: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  order: { id: string; number: string; status: string } | null;
  darkStore: { id: string; code: string; nameEn: string; nameAr: string } | null;
}

/**
 * One alerts list for both companies (docs/MERGE.md step 6). Operations opens it at
 * /admin/alerts with a company filter; Shiply's Alerts menu opens it filtered to Shiply.
 */
export async function AlertsList({
  basePath,
  all,
  company,
  companyFilter,
}: {
  /** The page it is shown on, for its own links */
  basePath: string;
  all?: string;
  company?: 'shiply_now' | 'shiply';
  /** Offer the company filter (the Operations page) */
  companyFilter: boolean;
}) {
  const query = new URLSearchParams();
  if (all === '1') query.set('open', 'false');
  if (company) query.set('company', company);
  const link = (next: { all?: string; company?: string }) => {
    const q = new URLSearchParams();
    if (next.all === '1') q.set('all', '1');
    if (companyFilter && next.company) q.set('company', next.company);
    const text = q.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const [alerts, t, stages, reasons, locale] = await Promise.all([
    apiGet<AlertRow[]>(`/admin/alerts${query.toString() ? `?${query}` : ''}`),
    getTranslations('admin.alerts'),
    getTranslations('orders.stages'),
    getTranslations('rider.reasons'),
    getLocale(),
  ]);

  const text = (a: AlertRow) => {
    const d = a.data ?? {};
    switch (a.type) {
      case 'late':
        return t('types.late', {
          stage: a.stage && stages.has(a.stage) ? stages(a.stage) : String(a.stage),
        });
      case 'item_missing':
        return t('types.item_missing', {
          sku: String(d.sku ?? ''),
          quantity: String(d.quantity ?? ''),
        });
      case 'cod_mismatch':
        return t('types.cod_mismatch', {
          expected: formatEgp(Number(d.expected ?? 0)),
          collected: formatEgp(Number(d.collected ?? 0)),
        });
      case 'network':
        // Shiply's network writes its alert's words itself.
        return String(d.message ?? d.kind ?? '');
      case 'delivery_failed': {
        const r = String(d.reason ?? '');
        return t('types.delivery_failed', { reason: reasons.has(r) ? reasons(r) : r });
      }
      default:
        return t.has(`types.${a.type}`)
          ? t(
              `types.${a.type}`,
              Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v ?? '')])),
            )
          : a.type;
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h2">{t('title')}</h1>
        <Link
          href={link({ all: all === '1' ? undefined : '1', company })}
          className="text-body-sm font-bold text-link"
        >
          {t('showAll')}
        </Link>
      </div>
      {companyFilter && (
        <nav className="mt-3 flex flex-wrap gap-2" aria-label={t('companyFilter')}>
          {([undefined, 'shiply_now', 'shiply'] as const).map((c) => (
            <Link
              key={c ?? 'all'}
              href={link({ all, company: c })}
              className={`rounded-full border px-3 py-1 text-body-sm ${
                company === c ? 'border-primary bg-selected-bg font-bold text-link' : 'border-line'
              }`}
            >
              {t(`companies.${c ?? 'all'}`)}
            </Link>
          ))}
        </nav>
      )}
      {alerts.length === 0 ? (
        <p className="mt-6 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-surface p-4 ${
                a.resolvedAt ? 'border-line opacity-70' : 'border-status-needs-action'
              }`}
            >
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="text-body-sm font-bold">
                  <span className="me-2 rounded-full bg-selected-bg px-2 py-0.5 text-caption font-bold text-link">
                    {t(`companies.${a.company}`)}
                  </span>
                  {text(a)}
                </p>
                <p className="text-caption text-text-muted">
                  {a.order && (
                    <Link
                      href={`/admin/orders/${a.order.id}`}
                      className="ltr-iso font-bold text-link"
                    >
                      {a.order.number}
                    </Link>
                  )}
                  {a.darkStore && <> · {localized(a.darkStore, locale)}</>} ·{' '}
                  <span className="ltr-iso">{formatCairoDateTime(a.createdAt, locale)}</span>
                </p>
                {a.resolvedBy && (
                  <p className="text-caption text-text-muted">
                    {t('handledBy', { name: a.resolvedBy })}
                  </p>
                )}
              </div>
              {!a.resolvedAt && <ResolveAlertButton alertId={a.id} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
