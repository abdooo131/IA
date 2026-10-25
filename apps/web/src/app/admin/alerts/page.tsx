import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ResolveAlertButton } from '@/components/orders/ResolveAlertButton';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface AlertRow {
  id: string;
  type: 'late' | 'item_missing' | 'cod_mismatch' | 'phone_invalid' | 'delivery_failed';
  stage: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  order: { id: string; number: string; status: string } | null;
  darkStore: { id: string; code: string; nameEn: string; nameAr: string } | null;
}

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const [alerts, t, stages, reasons, locale] = await Promise.all([
    apiGet<AlertRow[]>(`/admin/alerts${all === '1' ? '?open=false' : ''}`),
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
      case 'delivery_failed': {
        const r = String(d.reason ?? '');
        return t('types.delivery_failed', { reason: reasons.has(r) ? reasons(r) : r });
      }
      default:
        return t.has(`types.${a.type}`) ? t(`types.${a.type}`) : a.type;
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h2">{t('title')}</h1>
        <Link
          href={all === '1' ? '/admin/alerts' : '/admin/alerts?all=1'}
          className="text-body-sm font-bold text-link"
        >
          {t('showAll')}
        </Link>
      </div>
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
              <div>
                <p className="text-body-sm font-bold">{text(a)}</p>
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
