'use client';

import JsBarcode from 'jsbarcode';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { localized } from '@/lib/admin-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import type { OrderDetail } from '@/lib/order-types';

/**
 * The airway bill: an A6 label with the order number as a barcode, the store, the customer,
 * the area, the cash to collect and the number of items. It never shows the delivery code.
 */
export function OrderLabel({ order }: { order: OrderDetail }) {
  const t = useTranslations('orderDetail.label');
  const locale = useLocale();
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svg.current)
      JsBarcode(svg.current, order.number, {
        format: 'CODE128',
        height: 56,
        width: 2,
        displayValue: true,
        fontSize: 14,
        margin: 0,
      });
  }, [order.number]);
  const units = order.items.reduce((s, i) => s + i.quantity - i.cancelledQty, 0);
  const area = order.area
    ? localized(order.area, locale)
    : order.zone
      ? localized(order.zone, locale)
      : '';
  const cell = 'border-b border-black/70 px-3 py-2';
  return (
    <>
      <style>{'@media print { @page { size: A6; margin: 4mm; } }'}</style>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-primary">
          {t('print')}
        </button>
      </div>
      <article
        className="mt-4 w-full max-w-[105mm] overflow-hidden rounded-md border-2 border-black bg-white text-[13px] leading-snug text-black print:mt-0 print:max-w-none print:rounded-none"
        aria-label={t('title')}
      >
        <div className={`${cell} flex items-center justify-between gap-2`}>
          <img src="/brand/logo-horizontal-primary.svg" alt="Shiply Now" className="h-6 w-auto" />
          <span className="text-[11px] font-bold uppercase">{t('express')}</span>
        </div>
        <div className={`${cell} text-center`}>
          <svg ref={svg} className="mx-auto h-auto max-w-full" />
        </div>
        <div className={`${cell} grid grid-cols-2 gap-2`}>
          <div>
            <p className="text-[10px] uppercase">{t('from')}</p>
            <p className="font-bold">{localized(order.darkStore, locale)}</p>
            <p className="ltr-iso">{order.darkStore.code}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase">{t('merchant')}</p>
            <p className="font-bold">{order.merchant.name}</p>
          </div>
        </div>
        <div className={cell}>
          <p className="text-[10px] uppercase">{t('to')}</p>
          <p className="text-[15px] font-bold">{order.customerName}</p>
          <p className="ltr-iso">{order.customerPhone}</p>
          <p className="mt-1">{order.addressText}</p>
          {area && <p className="mt-1 font-bold">{area}</p>}
        </div>
        <div className="grid grid-cols-2">
          <div className="border-e border-black/70 px-3 py-2">
            <p className="text-[10px] uppercase">
              {order.paymentMethod === 'cod' ? t('cod') : t('prepaid')}
            </p>
            <p className="ltr-iso text-[18px] font-extrabold">
              EGP {formatEgp(order.codAmountPiastres)}
            </p>
          </div>
          <div className="px-3 py-2">
            <p className="text-[10px] uppercase">{t('items')}</p>
            <p className="ltr-iso text-[18px] font-extrabold">{units}</p>
          </div>
        </div>
        <p className="border-t border-black/70 px-3 py-1 text-[10px]">
          <span className="ltr-iso">{formatCairoDateTime(order.placedAt, locale)}</span>
        </p>
      </article>
    </>
  );
}
