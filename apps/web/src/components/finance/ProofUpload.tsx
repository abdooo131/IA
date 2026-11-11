'use client';

import { egpTextToPiastres, PAYOUT_PROOF_MAX_BYTES, PAYOUT_PROOF_TYPES } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const field = 'h-10 rounded-md border border-line-strong bg-surface px-3 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-line disabled:text-text-muted';

/**
 * Uploads a payout's proof of transfer: the bank slip (PDF, JPG or PNG, at most 5 MB) with the
 * amount and reference typed from it. The API refuses an amount that is not the payout's.
 */
export function ProofUpload({
  payoutId,
  amountPiastres,
  replacing = false,
  compact = false,
}: {
  payoutId: string;
  /** The payout's amount, prefilled; the person checks it against the slip */
  amountPiastres: number;
  replacing?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('finance.payoutControls');
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState((amountPiastres / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const errorText = (code: string) =>
    t(t.has(`errors.${code}`) ? `errors.${code}` : 'errors.generic');

  async function upload() {
    if (!file) return;
    if (!(PAYOUT_PROOF_TYPES as readonly string[]).includes(file.type))
      return setMessage({ text: errorText('file_type_not_allowed'), error: true });
    if (file.size > PAYOUT_PROOF_MAX_BYTES)
      return setMessage({ text: errorText('file_too_large'), error: true });
    const piastres = egpTextToPiastres(amount);
    if (piastres === null || piastres <= 0)
      return setMessage({ text: errorText('invalid_amount'), error: true });
    setBusy(true);
    setMessage(null);
    const q = new URLSearchParams({
      name: file.name.slice(0, 120) || 'slip',
      amountPiastres: String(piastres),
      reference: reference.trim(),
    });
    const res = await fetch(`/api/finance/payouts/${payoutId}/proof?${q.toString()}`, {
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? '';
      return setMessage({ text: errorText(code), error: true });
    }
    setMessage({ text: t('uploaded'), error: false });
    setFile(null);
    router.refresh();
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={`grid gap-2 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <label className="text-caption">
          {t('file')}
          <input
            type="file"
            accept={PAYOUT_PROOF_TYPES.join(',')}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-body-sm"
          />
        </label>
        <label className="text-caption">
          {t('amount')}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className={`${field} mt-1 block w-full`}
          />
        </label>
        <label className="text-caption">
          {t('reference')}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            dir="ltr"
            className={`${field} mt-1 block w-full`}
          />
        </label>
      </div>
      {replacing && <p className="text-caption text-text-muted">{t('replaceHint')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || !file || reference.trim().length < 2}
          onClick={() => void upload()}
        >
          {replacing ? t('replace') : t('upload')}
        </button>
        {message && (
          <p
            role="status"
            className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
