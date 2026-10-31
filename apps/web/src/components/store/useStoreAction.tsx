'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiGetClient } from '@/lib/api-client';

export interface ScannedSku {
  id: string;
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleAr: string;
}
export interface ScannedBin {
  id: string;
  code: string;
  type: 'receiving' | 'pickable' | 'damaged' | 'held';
}
type Lookup = { kind: 'sku'; sku: ScannedSku } | { kind: 'bin'; bin: ScannedBin };

const KNOWN = [
  'insufficient_bin_stock',
  'would_break_reservations',
  'manifest_closed',
  'sku_not_on_merchant',
  'bin_not_pickable',
  'nothing_to_put_away',
  'move_not_allowed',
  'rider_not_found',
  'no_damaged_bin',
  'network',
];

/** Shared message state and code lookup for the staff screens. */
export function useStoreAction(storeId: string) {
  const t = useTranslations();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (error: string) =>
    setMessage({
      text: t(`store.errors.${KNOWN.includes(error) ? error : 'generic'}`),
      error: true,
    });
  const ok = (text: string) => setMessage({ text, error: false });

  async function lookup(code: string): Promise<Lookup | null> {
    const result = await apiGetClient<Lookup>(
      `/stores/${storeId}/lookup?code=${encodeURIComponent(code)}`,
    );
    if (result.ok) return result.data;
    if (result.error === 'code_not_found')
      setMessage({ text: t('scan.notFound', { code }), error: true });
    else fail(result.error);
    return null;
  }

  async function lookupSku(code: string) {
    const found = await lookup(code);
    if (found?.kind === 'bin') setMessage({ text: t('scan.notProduct', { code }), error: true });
    return found?.kind === 'sku' ? found.sku : null;
  }

  async function lookupBin(code: string) {
    const found = await lookup(code);
    if (found?.kind === 'sku') setMessage({ text: t('scan.notBin', { code }), error: true });
    return found?.kind === 'bin' ? found.bin : null;
  }

  return { message, setMessage, busy, setBusy, fail, ok, lookupSku, lookupBin };
}

export function Message({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-body-sm ${
        message.error ? 'border-danger text-danger' : 'border-line bg-surface-raised text-text'
      }`}
    >
      {message.text}
    </p>
  );
}
