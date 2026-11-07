import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import { PurchaseOrderActions } from '@/components/finance/PurchaseOrders';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { PurchaseOrderDetail } from '@/lib/purchasing-types';
import { getClaims } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
const td = 'px-3 py-2';

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, doc, me, claims, t, locale] = await Promise.all([
    apiGet<PurchaseOrderDetail>(`/finance/purchase-orders/${id}`),
    apiGet<DocDescriptor>(`/finance/documents/purchase_order/${id}`),
    getMyProfile(),
    getClaims(),
    getTranslations('purchasing.orders'),
    getLocale(),
  ]);
  const name = (a: { code?: string; nameEn: string; nameAr: string }) =>
    `${a.code ? `${a.code} ` : ''}${locale === 'ar' ? a.nameAr : a.nameEn}`;
  return (
    <DocumentPage doc={doc} showFields={false}>
      <dl className="grid max-w-3xl gap-3 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-muted">{t('store')}</dt>
          <dd>{order.darkStore ? name(order.darkStore) : t('noStore')}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('total')}</dt>
          <dd className="font-bold">{formatEgp(order.totalPiastres)}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('requestedBy')}</dt>
          <dd>
            {order.requestedBy.name} ·{' '}
            <span className="ltr-iso">{formatCairoDateTime(order.createdAt, locale)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">{t('decidedBy')}</dt>
          <dd>
            {order.decidedBy?.name ?? (order.decidedAt ? t('belowLimit') : t('notYet'))}
            {order.decisionNote ? ` · ${order.decisionNote}` : ''}
          </dd>
        </div>
        {order.note && (
          <div className="sm:col-span-2">
            <dt className="text-caption text-text-muted">{t('note')}</dt>
            <dd>{order.note}</dd>
          </div>
        )}
        {order.quotePhotoId && (
          <div>
            <dt className="text-caption text-text-muted">{t('quote')}</dt>
            <dd>
              <a
                href={`/api/photos/${order.quotePhotoId}`}
                className="text-link"
                target="_blank"
                rel="noreferrer"
              >
                {t('openQuote')}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <div id="lines" className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('description')}</th>
              <th className={th}>{t('account')}</th>
              <th className={`${th} text-end`}>{t('quantity')}</th>
              <th className={`${th} text-end`}>{t('unitPrice')}</th>
              <th className={`${th} text-end`}>{t('receivedQty')}</th>
              <th className={`${th} text-end`}>{t('billedQty')}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className={td}>{l.description}</td>
                <td className={td}>
                  {l.packagingItem
                    ? `${t('packagingLine')}: ${name(l.packagingItem)}`
                    : l.expenseAccount
                      ? name(l.expenseAccount)
                      : ''}
                </td>
                <td className={`${td} text-end`}>{l.quantity}</td>
                <td className={`${td} text-end`}>{formatEgp(l.unitPricePiastres)}</td>
                <td className={`${td} text-end`}>{l.receivedQty}</td>
                <td className={`${td} text-end`}>{l.billedQty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.bills.length > 0 && (
        <section className="mt-4">
          <h2 className="text-h3">{t('bills')}</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-body-sm">
            {order.bills.map((b) => (
              <li key={b.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  <a href="/finance/bills" className="font-bold text-link">
                    {b.numberLabel}
                  </a>{' '}
                  · {b.reference} · <span className="ltr-iso">{b.billDate}</span>
                </span>
                <span>
                  {formatEgp(b.totalPiastres)} · {t(`billStatus.${b.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canDo(me, 'accounting', 'use') && (
        <PurchaseOrderActions
          order={order}
          canApprove={canDo(me, 'accounting', 'manage') && claims?.sub !== order.requestedBy.id}
        />
      )}
    </DocumentPage>
  );
}
