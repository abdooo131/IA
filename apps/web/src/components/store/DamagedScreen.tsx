'use client';

import { MOVE_REASONS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import { type BinWithItems, title } from '@/lib/store-types';
import { Message, type ScannedSku, useStoreAction } from './useStoreAction';

type Reason = Exclude<(typeof MOVE_REASONS)[number], 'relocate'>;

/** Same rules as the API: where each reason may take units from, and to. */
const RULES: Record<Reason, { from: BinWithItems['type'][]; to: BinWithItems['type'] }> = {
  damaged: { from: ['pickable', 'receiving', 'held'], to: 'damaged' },
  held: { from: ['pickable', 'receiving'], to: 'held' },
  release: { from: ['held'], to: 'pickable' },
};

export function DamagedScreen({
  storeId,
  initialBins,
}: {
  storeId: string;
  initialBins: BinWithItems[];
}) {
  const t = useTranslations('store.damaged');
  const types = useTranslations('store.binTypes');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [bins, setBins] = useState(initialBins);
  const [sku, setSku] = useState<ScannedSku | null>(null);
  const [reason, setReason] = useState<Reason>('damaged');
  const [fromId, setFromId] = useState('');
  const [quantity, setQuantity] = useState(1);

  const sources = sku
    ? bins.filter(
        (b) =>
          RULES[reason].from.includes(b.type) &&
          b.items.some((i) => i.skuId === sku.id && i.quantity > 0),
      )
    : [];
  const target = bins.find((b) => b.type === RULES[reason].to);
  const from = sources.find((b) => b.id === fromId) ?? sources[0];

  async function onCode(code: string) {
    action.setBusy(true);
    action.setMessage(null);
    const found = await action.lookupSku(code);
    if (found) {
      setSku(found);
      setFromId('');
      setQuantity(1);
    }
    action.setBusy(false);
  }

  async function confirm() {
    if (!sku || !from || !target) return;
    action.setBusy(true);
    const result = await apiSend('POST', `/stores/${storeId}/move`, {
      skuId: sku.id,
      fromBinId: from.id,
      toBinId: target.id,
      quantity,
      reason,
      idempotencyKey: newActionKey(),
    });
    if (result.ok) {
      action.ok(t('done', { quantity, sku: sku.sku, bin: target.code }));
      setSku(null);
      const fresh = await apiGetClient<BinWithItems[]>(`/stores/${storeId}/bins`);
      if (fresh.ok) setBins(fresh.data);
    } else action.fail(result.error);
    action.setBusy(false);
  }

  const select = 'h-12 w-full rounded-md border border-line bg-surface px-3 text-body';

  return (
    <div className="mt-2 space-y-4">
      <h1 className="text-h2">{t('title')}</h1>
      {!sku ? (
        <>
          <p className="text-body-sm font-bold">{t('stepProduct')}</p>
          <ScanBox onCode={onCode} disabled={action.busy} />
        </>
      ) : (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <p className="text-body">
            <span className="ltr-iso font-bold">{sku.sku}</span> {title(sku, locale)}
          </p>
          <label className="block text-caption">
            {t('reason')}
            <select
              className={select}
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
            >
              <option value="damaged">{t('damaged')}</option>
              <option value="held">{t('held')}</option>
              <option value="release">{t('release')}</option>
            </select>
          </label>
          {sources.length === 0 ? (
            <p className="text-body-sm text-danger">{t('noBins')}</p>
          ) : (
            <>
              <label className="block text-caption">
                {t('from')}
                <select
                  className={select}
                  value={from?.id}
                  onChange={(e) => setFromId(e.target.value)}
                >
                  {sources.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {types(b.type)} ·{' '}
                      {b.items.find((i) => i.skuId === sku.id)?.quantity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-caption">
                {t('quantity')}
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  dir="ltr"
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                  className="h-12 w-28 rounded-md border border-line bg-surface px-3 text-body"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={action.busy || !target}
                  className="h-12 flex-1 rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
                >
                  {t('confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setSku(null)}
                  className="h-12 rounded-md border border-line bg-surface px-4 font-bold"
                >
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <Message message={action.message} />
    </div>
  );
}
