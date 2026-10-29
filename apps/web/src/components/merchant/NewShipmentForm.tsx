'use client';

import { FormFooter } from '@/components/workflow/FormFooter';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { localized } from '@/lib/admin-types';
import { apiSend } from '@/lib/api-client';
import type { MerchantSku } from '@/lib/merchant-types';
import { type StoreRef, title } from '@/lib/store-types';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const KNOWN = ['reference_taken', 'validation_failed', 'duplicate_sku', 'shipments_go_to_hub'];

export function NewShipmentForm({ stores, skus }: { stores: StoreRef[]; skus: MerchantSku[] }) {
  const t = useTranslations('merchant.new');
  const locale = useLocale();
  const router = useRouter();
  const [lines, setLines] = useState([{ skuId: skus[0]?.id ?? '', expectedQty: 1 }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', '/merchant/manifests', {
      darkStoreId: form.get('darkStoreId'),
      reference: form.get('reference'),
      note: (form.get('note') as string) || undefined,
      expectedAt: (form.get('expectedAt') as string) || undefined,
      lines,
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setDirty(false);
    router.push('/merchant');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-xl space-y-4" onChange={() => setDirty(true)}>
      <label className="block text-caption">
        {t('store')}
        <select name="darkStoreId" required className={field}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, locale)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('reference')}
        <input name="reference" required maxLength={60} dir="ltr" className={field} />
      </label>
      <label className="block text-caption">
        {t('expectedAt')}
        <input name="expectedAt" type="date" dir="ltr" className={field} />
      </label>
      <label className="block text-caption">
        {t('note')}
        <input name="note" maxLength={500} className={field} />
      </label>

      <fieldset className="space-y-2 rounded-lg border border-line bg-surface p-3">
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-caption">
              {t('product')}
              <select
                className={field}
                value={line.skuId}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l, j) => (j === i ? { ...l, skuId: e.target.value } : l)),
                  )
                }
              >
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sku} · {title(s, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-24 text-caption">
              {t('quantity')}
              <input
                type="number"
                min={1}
                inputMode="numeric"
                dir="ltr"
                className={field}
                value={line.expectedQty}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((l, j) =>
                      j === i
                        ? {
                            ...l,
                            expectedQty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          }
                        : l,
                    ),
                  )
                }
              />
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="h-10 rounded-md border border-line px-3 text-body-sm"
              >
                {t('remove')}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              {
                skuId: skus.find((s) => !ls.some((l) => l.skuId === s.id))?.id ?? skus[0]!.id,
                expectedQty: 1,
              },
            ])
          }
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('addLine')}
        </button>
      </fieldset>

      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter dirty={dirty} busy={busy} saveLabel={t('submit')} cancelHref="/merchant" />
    </form>
  );
}
