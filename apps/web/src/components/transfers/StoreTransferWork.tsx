'use client';

import { StatusBar } from '@/components/workflow/StatusBar';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { Message, type ScannedBin, useStoreAction } from '@/components/store/useStoreAction';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import { title } from '@/lib/store-types';
import type { TransferDetail } from '@/lib/transfer-types';
import { TransferRoute } from './TransferRoute';
import { TransferStatusChip } from './TransferStatusChip';

const KNOWN = [
  'over_pick',
  'over_receive',
  'sku_not_on_transfer',
  'not_on_shelf',
  'bin_not_allowed',
  'invalid_transfer_state',
  'network',
];
const primary =
  'h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';

/** Sender: scan units onto the truck, then Send. Receiver: scan units off it, then Close. */
export function StoreTransferWork({
  storeId,
  initial,
}: {
  storeId: string;
  initial: TransferDetail;
}) {
  const t = useTranslations('transfers');
  const tScan = useTranslations('scan');
  const locale = useLocale();
  const action = useStoreAction(storeId);
  const [tr, setTr] = useState(initial);
  const [bin, setBin] = useState<ScannedBin | null>(null);
  const base = `/stores/${storeId}/transfers/${tr.id}`;
  const sending = tr.from.id === storeId && (tr.status === 'approved' || tr.status === 'picking');
  const receiving = tr.to.id === storeId && tr.status === 'in_transit';
  const fail = (error: string) =>
    action.setMessage({
      text: t(`errors.${KNOWN.includes(error) ? error : 'generic'}`),
      error: true,
    });

  async function reload() {
    const fresh = await apiGetClient<TransferDetail>(base);
    if (fresh.ok) setTr(fresh.data);
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
      action.setBusy(false);
      if (!sending) return;
      setBin(lookup.data.bin);
      return action.ok(t('fromBin', { bin: lookup.data.bin.code }));
    }
    const sku = lookup.data.sku!;
    const result = await apiSend<{ bin?: string }>(
      'POST',
      `${base}/${sending ? 'pick' : 'receive'}`,
      {
        skuId: sku.id,
        binId: sending ? bin?.id : undefined,
        quantity: 1,
        idempotencyKey: newActionKey(),
      },
    );
    if (result.ok) {
      action.ok(
        sending
          ? t('picked', { sku: sku.sku, bin: result.data.bin ?? '' })
          : t('received', { sku: sku.sku }),
      );
      navigator.vibrate?.(30);
    } else fail(result.error);
    await reload();
    action.setBusy(false);
  }

  async function finish() {
    const confirmText = sending ? t('sendConfirm') : t('closeConfirm');
    if (!window.confirm(confirmText)) return;
    action.setBusy(true);
    const result = await apiSend('POST', `${base}/${sending ? 'send' : 'close'}`, {});
    if (result.ok) action.ok(sending ? t('sent') : t('closed'));
    else fail(result.error);
    await reload();
    action.setBusy(false);
  }

  const picked = tr.lines.reduce((s, l) => s + l.pickedQty, 0);
  return (
    <div className="mt-2 space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="ltr-iso text-h2">{tr.reference}</h1>
          <TransferStatusChip status={tr.status} />
        </div>
        <StatusBar flow="transfer" status={tr.status} />
        <p className="text-body-sm">
          <TransferRoute from={tr.from} to={tr.to} finalDestination={tr.finalDestination} />
        </p>
        {tr.previous && <p className="text-caption text-text-muted">{t('crossDock')}</p>}
      </div>

      {(sending || receiving) && (
        <section className="space-y-2">
          <p className="text-body-sm font-bold">{sending ? t('scanToPick') : t('scanToReceive')}</p>
          <ScanBox onCode={(c) => void onCode(c)} disabled={action.busy} />
          {sending && (
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
          )}
        </section>
      )}
      <Message message={action.message} />

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {tr.lines.map((l) => {
          const done = sending ? l.pickedQty : l.receivedQty;
          const of = sending ? l.quantity : l.pickedQty;
          return (
            <li key={l.skuId} className="space-y-1 p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="ltr-iso block text-body-sm font-bold">{l.sku}</span>
                  <span className="block truncate text-body-sm">{title(l, locale)}</span>
                </span>
                <span className="ltr-iso shrink-0 text-h3">
                  {done}/{of}
                </span>
              </div>
              {sending && l.pickedQty < l.quantity && l.bins.length > 0 && (
                <p className="text-caption">
                  {t('where')}:{' '}
                  <span className="ltr-iso">
                    {l.bins.map((b) => `${b.code} (${b.quantity})`).join(', ')}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {sending && tr.status === 'picking' && (
        <button
          type="button"
          className={primary}
          disabled={action.busy || picked === 0}
          onClick={() => void finish()}
        >
          {t('send')}
        </button>
      )}
      {receiving && (
        <button
          type="button"
          className={primary}
          disabled={action.busy}
          onClick={() => void finish()}
        >
          {t('close')}
        </button>
      )}
      {receiving && <p className="text-caption text-text-muted">{t('putAwayAfter')}</p>}
    </div>
  );
}
