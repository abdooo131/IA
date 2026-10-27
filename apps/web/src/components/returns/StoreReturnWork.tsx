'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { Message, type ScannedBin, useStoreAction } from '@/components/store/useStoreAction';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import type { ReturnDetail } from '@/lib/return-types';
import { title } from '@/lib/store-types';
import { ReturnStatusChip } from './ReturnStatusChip';

const KNOWN = [
  'over_pick',
  'sku_not_on_return',
  'not_on_shelf',
  'bin_not_allowed',
  'invalid_return_state',
  'network',
];
const primary =
  'h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';

/** Staff pick a merchant return by scan (bin first is optional), then hand it over. */
export function StoreReturnWork({ storeId, initial }: { storeId: string; initial: ReturnDetail }) {
  const t = useTranslations('returns');
  const tScan = useTranslations('scan');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [ret, setRet] = useState(initial);
  const [bin, setBin] = useState<ScannedBin | null>(null);
  const [collectedBy, setCollectedBy] = useState('');
  const base = `/stores/${storeId}/returns/${ret.id}`;
  const fail = (error: string) =>
    action.setMessage({
      text: t(`errors.${KNOWN.includes(error) ? error : 'generic'}`),
      error: true,
    });

  async function reload() {
    const fresh = await apiGetClient<ReturnDetail>(base);
    if (fresh.ok) setRet(fresh.data);
  }

  async function onCode(code: string) {
    action.setBusy(true);
    action.setMessage(null);
    const lookup = await apiGetClient<{
      kind: 'sku' | 'bin';
      sku?: { id: string; sku: string };
      bin?: ScannedBin;
    }>(`/stores/${storeId}/lookup?code=${encodeURIComponent(code)}`);
    if (!lookup.ok) {
      action.setBusy(false);
      if (lookup.error === 'code_not_found')
        return action.setMessage({ text: tScan('notFound', { code }), error: true });
      return fail(lookup.error);
    }
    if (lookup.data.kind === 'bin' && lookup.data.bin) {
      setBin(lookup.data.bin);
      action.setBusy(false);
      return action.ok(t('fromBin', { bin: lookup.data.bin.code }));
    }
    const sku = lookup.data.sku!;
    const result = await apiSend<{ bin: string }>('POST', `${base}/pick`, {
      skuId: sku.id,
      binId: bin?.id,
      quantity: 1,
      idempotencyKey: newActionKey(),
    });
    if (result.ok) {
      action.ok(t('picked', { sku: sku.sku, bin: result.data.bin }));
      navigator.vibrate?.(30);
    } else fail(result.error);
    await reload();
    action.setBusy(false);
  }

  async function handOver() {
    action.setBusy(true);
    const result = await apiSend('POST', `${base}/hand-over`, { collectedBy });
    if (result.ok) action.ok(t('handedOver'));
    else fail(result.error);
    await reload();
    action.setBusy(false);
  }

  const picking = ret.status === 'requested' || ret.status === 'picking';
  return (
    <div className="mt-2 space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-h2">{ret.merchant.name}</h1>
          <ReturnStatusChip status={ret.status} />
        </div>
        <p className="ltr-iso text-body-sm font-bold">{ret.reference}</p>
        {ret.note && <p className="text-body-sm">{ret.note}</p>}
      </div>

      {picking && (
        <section className="space-y-2">
          <p className="text-body-sm font-bold">{t('scanToPick')}</p>
          <ScanBox onCode={(c) => void onCode(c)} disabled={action.busy} />
          <p className="text-caption text-text-muted">
            {t('binNow')}: <span className="ltr-iso">{bin?.code ?? t('anyBin')}</span>
            {bin && (
              <button
                type="button"
                className="ms-2 text-link underline"
                onClick={() => setBin(null)}
              >
                ✕
              </button>
            )}
          </p>
        </section>
      )}
      <Message message={action.message} />

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {ret.lines.map((l) => (
          <li key={`${l.skuId}:${l.source}`} className="space-y-1 p-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="ltr-iso block text-body-sm font-bold">{l.sku}</span>
                <span className="block truncate text-body-sm">{title(l, locale)}</span>
                <span className="block text-caption text-text-muted">
                  {t(`sources.${l.source}`)}
                </span>
              </span>
              <span className="ltr-iso shrink-0 text-h3">
                {l.pickedQty}/{l.quantity}
              </span>
            </div>
            {l.pickedQty < l.quantity && l.bins.length > 0 && (
              <p className="text-caption">
                {t('where')}:{' '}
                <span className="ltr-iso">
                  {l.bins.map((b) => `${b.code} (${b.quantity})`).join(', ')}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>

      {ret.status === 'ready' && (
        <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <label className="block text-body-sm font-bold">
            {t('collectedBy')}
            <input
              value={collectedBy}
              onChange={(e) => setCollectedBy(e.target.value)}
              maxLength={120}
              className="mt-1 block h-12 w-full rounded-md border border-line bg-surface px-3 font-normal"
            />
          </label>
          <button
            type="button"
            className={primary}
            disabled={action.busy || collectedBy.trim().length < 2}
            onClick={() => void handOver()}
          >
            {t('handOver')}
          </button>
        </section>
      )}
    </div>
  );
}
