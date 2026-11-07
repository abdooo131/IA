import { getLocale, getTranslations } from 'next-intl/server';
import { PrintButton } from '@/components/finance/PrintButton';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { OrderDetail, OrderMoney } from '@/lib/order-types';
import { title } from '@/lib/store-types';

/**
 * A compact, printable summary of one order: who, where, what, and the money. It never shows
 * the delivery code, so it can be printed or shared by any viewer of the order.
 */
export async function OrderSummarySheet({
  order,
  money,
  showMerchant,
}: {
  order: OrderDetail;
  money: OrderMoney | null;
  showMerchant: boolean;
}) {
  const [t, to, tw, locale] = await Promise.all([
    getTranslations('orderDetail'),
    getTranslations('orders'),
    getTranslations('workflow.states'),
    getLocale(),
  ]);
  const units = order.items.reduce((s, i) => s + i.quantity - i.cancelledQty, 0);
  const products = order.items.reduce(
    (s, i) => s + (i.quantity - i.cancelledQty) * i.unitPricePiastres,
    0,
  );
  const egp = (p: number) => `EGP ${formatEgp(p)}`;
  const row = 'flex justify-between gap-4 border-b border-line py-1.5 last:border-0';
  return (
    <article className="mt-3 max-w-2xl space-y-4 rounded-xl bg-surface p-5 shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label uppercase text-text-muted">{t('summaryTitle')}</p>
          <h1 className="text-h2">
            <span className="ltr-iso">{order.number}</span>
          </h1>
          <p className="text-body-sm text-text-muted">
            {tw.has(order.status) ? tw(order.status) : order.status} ·{' '}
            <span className="ltr-iso">{formatCairoDateTime(order.placedAt, locale)}</span>
          </p>
        </div>
        <PrintButton />
      </header>
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="text-body-sm">
          <h2 className="mb-1 text-label uppercase text-text-muted">{t('consignee.title')}</h2>
          <p className="font-bold">{order.customerName}</p>
          <p className="ltr-iso">{order.customerPhone}</p>
          <p>{order.addressText}</p>
          {order.area && <p className="text-text-muted">{localized(order.area, locale)}</p>}
        </div>
        <div className="text-body-sm">
          <h2 className="mb-1 text-label uppercase text-text-muted">{t('additional.title')}</h2>
          <p>
            {t('consignee.store')}: {localized(order.darkStore, locale)}
          </p>
          {showMerchant && (
            <p>
              {t('additional.merchant')}: {order.merchant.name}
            </p>
          )}
          <p>
            {t('additional.source')}: {t(`additional.sources.${order.source}`)}
          </p>
          {order.slaDueAt && (
            <p>
              {t('operation.expected')}:{' '}
              <span className="ltr-iso">{formatCairoDateTime(order.slaDueAt, locale)}</span>
            </p>
          )}
          {order.deliveredAt && (
            <p>
              {t('operation.deliveredAt')}:{' '}
              <span className="ltr-iso">{formatCairoDateTime(order.deliveredAt, locale)}</span>
            </p>
          )}
        </div>
      </section>
      <section>
        <h2 className="mb-1 text-label uppercase text-text-muted">
          {t('shipment.count', { lines: order.items.length, units })}
        </h2>
        <table className="w-full text-body-sm">
          <tbody>
            {order.items.map((i) => (
              <tr key={i.skuId} className="border-b border-line last:border-0">
                <td className="py-1.5 pe-2">
                  <span className="ltr-iso font-bold">{i.sku}</span> {title(i, locale)}
                </td>
                <td className="ltr-iso py-1.5 text-end">× {i.quantity - i.cancelledQty}</td>
                <td className="ltr-iso py-1.5 ps-2 text-end">
                  {formatEgp(i.unitPricePiastres * (i.quantity - i.cancelledQty))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="text-body-sm sm:ms-auto sm:max-w-xs">
        <p className={row}>
          <span>{t('collection.products')}</span>
          <span className="ltr-iso">{egp(products)}</span>
        </p>
        <p className={row}>
          <span>{t('collection.deliveryFee')}</span>
          <span className="ltr-iso">{egp(order.deliveryFeePiastres)}</span>
        </p>
        <p className={`${row} font-bold`}>
          <span>{order.paymentMethod === 'cod' ? to('codAmount') : to('prepaid')}</span>
          <span className="ltr-iso">{egp(order.codAmountPiastres)}</span>
        </p>
        {money && money.fees.length > 0 && (
          <p className={row}>
            <span>{t('collection.dues')}</span>
            <span className="ltr-iso">{egp(money.duesPiastres)}</span>
          </p>
        )}
      </section>
    </article>
  );
}
