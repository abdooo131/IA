'use client';
import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';
import { egp } from '@/parcels/lib/format';

export interface LabelData {
  trackingNumber: string;
  /** Big routing code: the delivery hub code, or the governorate code when the hub is unknown. */
  route: string;
  routeDetail?: string;
  merchantName?: string;
  customerName: string;
  customerPhone: string;
  address: string;
  codAmount: number;
  size: string;
  allowOpen: boolean;
  merchantRef: string;
  description: string;
}

/** One 100 x 150 mm shipping label. Prints one per page. */
export function Label({ data }: { data: LabelData }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svg.current) {
      JsBarcode(svg.current, data.trackingNumber, {
        format: 'CODE128',
        displayValue: false,
        height: 70,
        width: 2,
        margin: 0,
      });
    }
  }, [data.trackingNumber]);

  return (
    <div
      dir="ltr"
      className="label mx-auto flex flex-col overflow-hidden bg-white text-black shadow-md ring-1 ring-line print:shadow-none print:ring-0"
      style={{ width: '100mm', height: '150mm', padding: '4mm' }}
    >
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <img src="/brand/logo-horizontal-primary.svg" alt="Shiply" className="h-[7mm] w-auto" />
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
            Next day delivery
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-black leading-none">{data.route}</div>
          {data.routeDetail && <div className="text-xs font-semibold">{data.routeDetail}</div>}
        </div>
      </div>

      <div className="flex flex-col items-center border-b-2 border-black py-2">
        <svg ref={svg} className="h-[18mm] w-full" />
        <div className="mt-1 font-mono text-base font-bold tracking-widest">
          {data.trackingNumber}
        </div>
      </div>

      <div className="flex-1 border-b-2 border-black py-2 text-sm leading-snug">
        <div className="text-[10px] font-bold uppercase">Deliver to</div>
        <div className="text-base font-bold">{data.customerName}</div>
        <div className="font-mono">{data.customerPhone}</div>
        <div className="mt-1 line-clamp-4 break-words">{data.address}</div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 border-b-2 border-black py-2">
        <div>
          <div className="text-[10px] font-bold uppercase">Cash to collect</div>
          <div
            className={
              data.codAmount > 0
                ? 'text-2xl font-black leading-tight'
                : 'text-sm font-bold leading-tight'
            }
          >
            {data.codAmount > 0 ? egp(data.codAmount) : 'No cash to collect'}
          </div>
        </div>
        <div className="text-right text-xs">
          <div>
            <span className="font-bold">Size</span> {data.size}
          </div>
          <div>
            <span className="font-bold">Open before paying</span> {data.allowOpen ? 'Yes' : 'No'}
          </div>
        </div>
      </div>

      <div className="pt-2 text-[11px] leading-snug">
        {data.merchantName && (
          <div>
            <span className="font-bold">From</span> {data.merchantName}
          </div>
        )}
        {data.merchantRef && (
          <div>
            <span className="font-bold">Ref</span> {data.merchantRef}
          </div>
        )}
        {data.description && (
          <div className="line-clamp-2">
            <span className="font-bold">Contents</span> {data.description}
          </div>
        )}
      </div>
    </div>
  );
}
