'use client';

import JsBarcode from 'jsbarcode';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

function Label({ code, type }: { code: string; type: string }) {
  const types = useTranslations('store.binTypes');
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svg.current)
      JsBarcode(svg.current, code, {
        format: 'CODE128',
        height: 60,
        displayValue: true,
        margin: 4,
      });
  }, [code]);
  return (
    <div className="break-inside-avoid rounded-md border border-line bg-white p-3 text-center text-[#13294B]">
      <svg ref={svg} className="mx-auto h-auto max-w-full" />
      <p className="text-caption">{types(type)}</p>
    </div>
  );
}

export function BinLabels({ bins }: { bins: { code: string; type: string }[] }) {
  const t = useTranslations('store.labels');
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-4 h-12 rounded-md bg-selected-bg px-6 font-bold text-link print:hidden"
      >
        {t('print')}
      </button>
      <div className="mt-4 grid grid-cols-2 gap-3 print:mt-0">
        {bins.map((b) => (
          <Label key={b.code} code={b.code} type={b.type} />
        ))}
      </div>
    </>
  );
}
