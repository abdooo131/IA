'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import { type BinWithItems, title } from '@/lib/store-types';
import { Message, type ScannedBin, type ScannedSku, useStoreAction } from './useStoreAction';

export function PutAwayScreen({
  storeId,
  initialBins,
}: {
  storeId: string;
  initialBins: BinWithItems[];
}) {
  const t = useTranslations('store.putAway');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [bins, setBins] = useState(initialBins);
  const [sku, setSku] = useState<ScannedSku | null>(null);
  const [shelf, setShelf] = useState<ScannedBin | null>(null);
  const [quantity, setQuantity] = useState(1);

  const waiting = bins.filter((b) => b.type === 'receiving').flatMap((b) => b.items);
  const available = (skuId: string) =>
    waiting.filter((i) => i.skuId === skuId).reduce((s, i) => s + i.quantity, 0);

  async function onCode(code: string) {
    action.setBusy(true);
    action.setMessage(null);
    if (!sku) {
      const found = await action.lookupSku(code);
      if (found) {
        setSku(found);
        setQuantity(Math.max(1, available(found.id)));
      }
    } else if (!shelf) {
      const found = await action.lookupBin(code);
      if (found && found.type !== 'pickable') action.fail('bin_not_pickable');
      else if (found) setShelf(found);
    }
    action.setBusy(false);
  }

  async function confirm() {
    if (!sku || !shelf) return;
    action.setBusy(true);
    const result = await apiSend('POST', `/stores/${storeId}/put-away`, {
      skuId: sku.id,
      toBinId: shelf.id,
      quantity,
      idempotencyKey: newActionKey(),
    });
    if (result.ok) {
      action.ok(t('done', { quantity, sku: sku.sku, bin: shelf.code }));
      setSku(null);
      setShelf(null);
      const fresh = await apiGetClient<BinWithItems[]>(`/stores/${storeId}/bins`);
      if (fresh.ok) setBins(fresh.data);
    } else action.fail(result.error);
    action.setBusy(false);
  }

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-h2">{t('title')}</h1>
      <ol className="space-y-1 text-body-sm">
        <li className={sku ? 'text-text-muted line-through' : 'font-bold'}>
          {t('stepProduct')}
          {sku && <span className="ltr-iso ms-2 no-underline">{sku.sku}</span>}
        </li>
        <li
          className={
            !sku ? 'text-text-muted' : shelf ? 'text-text-muted line-through' : 'font-bold'
          }
        >
          {t('stepBin')}
          {shelf && <span className="ltr-iso ms-2">{shelf.code}</span>}
        </li>
        <li className={sku && shelf ? 'font-bold' : 'text-text-muted'}>{t('stepQty')}</li>
      </ol>

      {!(sku && shelf) && (
        <ScanBox key={sku ? 'bin' : 'sku'} onCode={onCode} disabled={action.busy} />
      )}

      {sku && shelf && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-body">
            <span className="ltr-iso font-bold">{sku.sku}</span> {title(sku, locale)}
          </p>
          <p className="text-body-sm text-text-muted">{t('toShelf', { bin: shelf.code })}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-12 w-12 rounded-md border border-line text-h3"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              dir="ltr"
              aria-label={t('stepQty')}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="h-12 w-24 rounded-md border border-line bg-surface text-center text-h3"
            />
            <button
              type="button"
              className="h-12 w-12 rounded-md border border-line text-h3"
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={action.busy}
              className="h-12 flex-1 rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
            >
              {t('confirm')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSku(null);
                setShelf(null);
              }}
              className="h-12 rounded-md border border-line bg-surface px-4 font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <Message message={action.message} />

      <section>
        <h2 className="text-body font-bold">{t('waiting')}</h2>
        {waiting.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('empty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {waiting.map((i) => (
              <li
                key={i.skuId}
                className="flex items-center justify-between gap-3 p-3 text-body-sm"
              >
                <span className="min-w-0">
                  <span className="ltr-iso font-bold">{i.sku}</span>{' '}
                  <span className="truncate">{title(i, locale)}</span>
                </span>
                <span className="ltr-iso text-h3">{i.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
