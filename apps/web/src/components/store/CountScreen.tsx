'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { apiSend } from '@/lib/api-client';
import { type BinWithItems, title } from '@/lib/store-types';
import { Message, type ScannedBin, useStoreAction } from './useStoreAction';

interface Line {
  skuId: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  counted: number;
}

/** Blind count: staff see which products belong in the bin, but not how many. */
export function CountScreen({
  storeId,
  initialBins,
}: {
  storeId: string;
  initialBins: BinWithItems[];
}) {
  const t = useTranslations('store.count');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [bin, setBin] = useState<ScannedBin | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [sent, setSent] = useState(false);

  async function onCode(code: string) {
    action.setBusy(true);
    action.setMessage(null);
    if (!bin) {
      const found = await action.lookupBin(code);
      if (found) {
        setBin(found);
        setSent(false);
        const items = initialBins.find((b) => b.id === found.id)?.items ?? [];
        setLines(
          items.map((i) => ({
            skuId: i.skuId,
            sku: i.sku,
            titleEn: i.titleEn,
            titleAr: i.titleAr,
            counted: 0,
          })),
        );
      }
    } else {
      const sku = await action.lookupSku(code);
      if (sku) {
        navigator.vibrate?.(30);
        setLines((current) =>
          current.some((l) => l.skuId === sku.id)
            ? current.map((l) => (l.skuId === sku.id ? { ...l, counted: l.counted + 1 } : l))
            : [
                ...current,
                {
                  skuId: sku.id,
                  sku: sku.sku,
                  titleEn: sku.titleEn,
                  titleAr: sku.titleAr,
                  counted: 1,
                },
              ],
        );
      }
    }
    action.setBusy(false);
  }

  const change = (skuId: string, by: number) =>
    setLines((current) =>
      current.map((l) => (l.skuId === skuId ? { ...l, counted: Math.max(0, l.counted + by) } : l)),
    );

  async function submit() {
    if (!bin) return;
    action.setBusy(true);
    const result = await apiSend<{ variances: number }>('POST', `/stores/${storeId}/counts`, {
      binId: bin.id,
      lines: lines.map((l) => ({ skuId: l.skuId, countedQty: l.counted })),
    });
    action.setBusy(false);
    if (!result.ok) return action.fail(result.error);
    setSent(true);
    action.ok(
      result.data.variances > 0
        ? t('submitted', { variances: result.data.variances })
        : t('noDiff'),
    );
  }

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-h2">{t('title')}</h1>
      {!bin ? (
        <>
          <p className="text-body-sm font-bold">{t('stepBin')}</p>
          <ScanBox key="bin" onCode={onCode} disabled={action.busy} />
        </>
      ) : (
        <>
          <p className="text-h3">{t('bin', { bin: bin.code })}</p>
          {!sent && (
            <>
              <p className="text-body-sm text-text-muted">{t('hint')}</p>
              <ScanBox key="sku" onCode={onCode} disabled={action.busy} />
            </>
          )}
        </>
      )}
      <Message message={action.message} />

      {bin && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {lines.map((l) => (
            <li key={l.skuId} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0 text-body-sm">
                <span className="ltr-iso block font-bold">{l.sku}</span>
                <span className="block truncate">{title(l, locale)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={sent}
                  aria-label="−"
                  onClick={() => change(l.skuId, -1)}
                  className="h-10 w-10 rounded-md border border-line text-h3"
                >
                  −
                </button>
                <span className="ltr-iso w-10 text-center text-h3">{l.counted}</span>
                <button
                  type="button"
                  disabled={sent}
                  aria-label="+"
                  onClick={() => change(l.skuId, 1)}
                  className="h-10 w-10 rounded-md border border-line text-h3"
                >
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {bin && !sent && (
        <button
          type="button"
          onClick={submit}
          disabled={action.busy}
          className="h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
        >
          {t('submit')}
        </button>
      )}
      {sent && (
        <button
          type="button"
          onClick={() => {
            setBin(null);
            setLines([]);
            action.setMessage(null);
          }}
          className="h-12 w-full rounded-md bg-selected-bg font-bold text-link"
        >
          {t('another')}
        </button>
      )}
    </div>
  );
}
