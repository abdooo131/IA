'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ScanBox } from '@/components/scan/ScanBox';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { newActionKey } from '@/lib/ids';
import { type ManifestDetail, title } from '@/lib/store-types';
import { Message, useStoreAction } from './useStoreAction';

export function ReceiveScreen({ storeId, initial }: { storeId: string; initial: ManifestDetail }) {
  const t = useTranslations('store.receive');
  const locale = useLocale();
  const router = useRouter();
  const action = useStoreAction(storeId);
  const [manifest, setManifest] = useState(initial);
  const [perScan, setPerScan] = useState(1);
  const open = manifest.status === 'expected' || manifest.status === 'receiving';

  async function reload() {
    const fresh = await apiGetClient<ManifestDetail>(`/stores/${storeId}/manifests/${manifest.id}`);
    if (fresh.ok) setManifest(fresh.data);
  }

  async function onCode(code: string) {
    action.setBusy(true);
    const sku = await action.lookupSku(code);
    if (sku) {
      const result = await apiSend('POST', `/stores/${storeId}/manifests/${manifest.id}/receive`, {
        skuId: sku.id,
        quantity: perScan,
        idempotencyKey: newActionKey(),
      });
      if (result.ok) {
        action.ok(t('scanned', { quantity: perScan, sku: `${sku.sku} ${title(sku, locale)}` }));
        navigator.vibrate?.(30);
        await reload();
      } else action.fail(result.error);
    }
    action.setBusy(false);
  }

  async function close() {
    if (!window.confirm(t('closeConfirm'))) return;
    action.setBusy(true);
    const result = await apiSend('POST', `/stores/${storeId}/manifests/${manifest.id}/close`, {});
    action.setBusy(false);
    if (!result.ok) return action.fail(result.error);
    action.ok(t('closed'));
    await reload();
    router.refresh();
  }

  const expected = manifest.lines.reduce((s, l) => s + l.expectedQty, 0);
  const received = manifest.lines.reduce((s, l) => s + l.receivedQty, 0);

  return (
    <div className="mt-2 space-y-4">
      <div>
        <h1 className="text-h2">{manifest.merchant.name}</h1>
        <p className="ltr-iso text-body-sm font-bold">{manifest.reference}</p>
        <p className="text-body-sm text-text-muted">{t('units', { received, expected })}</p>
      </div>

      {open && (
        <div className="space-y-2">
          <ScanBox onCode={onCode} disabled={action.busy} />
          <label className="flex items-center gap-2 text-body-sm">
            {t('quantity')}
            <input
              type="number"
              min={1}
              inputMode="numeric"
              dir="ltr"
              value={perScan}
              onChange={(e) => setPerScan(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="h-10 w-20 rounded-md border border-line bg-surface px-2"
            />
          </label>
        </div>
      )}
      <Message message={action.message} />

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {manifest.lines.map((l) => {
          const diff = l.receivedQty - l.expectedQty;
          const done = diff === 0;
          return (
            <li key={l.skuId} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="ltr-iso block text-body-sm font-bold">{l.sku}</span>
                <span className="block truncate text-body-sm">{title(l, locale)}</span>
                {l.expectedQty === 0 && (
                  <span className="block text-caption text-text-muted">{t('extra')}</span>
                )}
              </span>
              <span className="shrink-0 text-end">
                <span className="ltr-iso block text-h3">
                  {l.receivedQty}/{l.expectedQty}
                </span>
                {!done && (
                  <span className="block text-caption text-text-muted">
                    {diff < 0 ? t('missing', { count: -diff }) : t('over', { count: diff })}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {open && (
        <button
          type="button"
          onClick={close}
          disabled={action.busy}
          className="h-12 w-full rounded-md bg-primary font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
        >
          {t('close')}
        </button>
      )}
    </div>
  );
}
