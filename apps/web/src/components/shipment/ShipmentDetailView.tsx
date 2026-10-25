import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime } from '@/lib/format';
import type { ShipmentDetail } from '@/lib/shipment-types';
import { title } from '@/lib/store-types';

/** The full story of one shipment, shared by the merchant panel and admin. */
export async function ShipmentDetailView({
  detail,
  backHref,
}: {
  detail: ShipmentDetail;
  backHref: string;
}) {
  const [t, statuses, locale] = await Promise.all([
    getTranslations('shipment'),
    getTranslations('merchant.shipments.statuses'),
    getLocale(),
  ]);
  const when = (iso: string | null) =>
    iso ? <span className="ltr-iso">{formatCairoDateTime(iso, locale)}</span> : '—';
  const expected = detail.lines.reduce((s, l) => s + l.expectedQty, 0);
  const received = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const started = detail.status !== 'expected';
  const card = 'rounded-lg border border-line bg-surface p-4 shadow-sm';

  return (
    <div className="space-y-5">
      <Link href={backHref} className="text-body-sm font-bold text-link">
        <span aria-hidden className="inline-block rtl:rotate-180">
          ←
        </span>{' '}
        {t('back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h2">
          {t('title', { reference: '' })}
          <span className="ltr-iso">{detail.reference}</span>
        </h1>
        <span className="rounded-pill border border-line px-2.5 py-0.5 text-caption">
          {statuses(detail.status)}
        </span>
      </div>
      <p className="text-body-sm text-text-muted">{t('totals', { received, expected })}</p>

      <section className={card}>
        <dl className="grid gap-3 text-body-sm sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-muted">{t('merchant')}</dt>
            <dd className="font-bold">{detail.merchant.name}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('store')}</dt>
            <dd className="font-bold">{localized(detail.darkStore, locale)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('createdAt')}</dt>
            <dd>{when(detail.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('createdBy')}</dt>
            <dd>
              {detail.createdBy ? `${detail.createdBy.name} (${detail.createdBy.email})` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('expectedAt')}</dt>
            <dd>{when(detail.expectedAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('receivedAt')}</dt>
            <dd>{when(detail.receivedAt)}</dd>
          </div>
          {detail.note && (
            <div className="sm:col-span-2">
              <dt className="text-caption text-text-muted">{t('note')}</dt>
              <dd>{detail.note}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-h3">{t('timeline')}</h2>
        <ol className="mt-3 space-y-3 border-s-2 border-line ps-4">
          {detail.timeline.map((e, i) => (
            <li key={i} className="relative">
              <span
                aria-hidden
                className="absolute -start-[23px] top-1.5 h-3 w-3 rounded-full bg-primary"
              />
              <p className="text-body-sm font-bold">{t(`events.${e.event}`)}</p>
              <p className="text-caption text-text-muted">
                {when(e.at)}
                {e.by && <> · {t('by', { name: e.by })}</>}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className={card}>
        <h2 className="text-h3">{t('products')}</h2>
        <ul className="mt-2 divide-y divide-line">
          {detail.lines.map((l) => {
            const diff = l.receivedQty - l.expectedQty;
            return (
              <li key={l.skuId} className="py-2 text-body-sm">
                <p>
                  <span className="ltr-iso font-bold">{l.sku}</span> {title(l, locale)}
                  {l.barcode && (
                    <span className="ltr-iso ms-2 text-caption text-text-muted">{l.barcode}</span>
                  )}
                </p>
                {l.expectedQty === 0 && (
                  <p className="text-caption text-text-muted">{t('extra')}</p>
                )}
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-text-muted">
                  <span>
                    {t('sent')} <span className="ltr-iso font-bold text-text">{l.expectedQty}</span>
                  </span>
                  <span>
                    {t('received')}{' '}
                    <span className="ltr-iso font-bold text-text">{l.receivedQty}</span>
                  </span>
                  {started && (
                    <span className="font-bold text-text">
                      {diff === 0
                        ? t('complete')
                        : diff < 0
                          ? t('missing', { count: -diff })
                          : t('over', { count: diff })}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-h3">{t('scans')}</h2>
        {detail.scans.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noScans')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-body-sm">
              <thead>
                <tr className="text-caption text-text-muted">
                  <th className="py-1 text-start font-medium">{t('scanTime')}</th>
                  <th className="py-1 text-start font-medium">{t('scanBy')}</th>
                  <th className="py-1 text-start font-medium">{t('product')}</th>
                  <th className="py-1 text-end font-medium">{t('scanQty')}</th>
                  <th className="py-1 text-end font-medium">{t('scanBin')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.scans.map((s, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 pe-2">{when(s.at)}</td>
                    <td className="py-1.5 pe-2">{s.by ?? '—'}</td>
                    <td className="py-1.5 pe-2">
                      <span className="ltr-iso font-bold">{s.sku}</span> {title(s, locale)}
                    </td>
                    <td className="ltr-iso py-1.5 text-end">{s.quantity}</td>
                    <td className="ltr-iso py-1.5 text-end">{s.bin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
