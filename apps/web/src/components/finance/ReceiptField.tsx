'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { shrinkPhoto, uploadPhoto } from '@/lib/photo';

/**
 * A receipt or transfer slip photo for a money movement. It uploads the photo at once and
 * puts its id in a hidden field named `receiptPhotoId`, or reports it through `onChange`.
 * Clears itself when its form is reset.
 */
export function ReceiptField({ onChange }: { onChange?: (photoId: string | null) => void }) {
  const t = useTranslations('finance.receipts');
  const file = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');

  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const clear = () => {
      setPhotoId(null);
      setState('idle');
    };
    form.addEventListener('reset', clear);
    return () => form.removeEventListener('reset', clear);
  }, []);

  async function chosen(picked: File | undefined) {
    if (!picked) return;
    setState('busy');
    const small = await shrinkPhoto(picked).catch(() => picked);
    const result = await uploadPhoto('receipt', small);
    if (file.current) file.current.value = '';
    if (!result.ok) return setState('error');
    setPhotoId(result.id);
    setState('idle');
    onChange?.(result.id);
  }

  return (
    <div className="text-caption sm:col-span-2">
      <input ref={hidden} type="hidden" name="receiptPhotoId" value={photoId ?? ''} />
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={t('attach')}
        onChange={(e) => void chosen(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={() => file.current?.click()}
        className="h-10 rounded-md border border-line bg-surface px-3 text-body-sm font-bold disabled:opacity-50"
      >
        {photoId ? t('replace') : t('attach')}
      </button>
      <span className={`ms-2 ${state === 'error' ? 'text-danger' : 'text-text-muted'}`}>
        {state === 'busy'
          ? t('uploading')
          : state === 'error'
            ? t('failed')
            : photoId
              ? t('attached')
              : t('hint')}
      </span>
    </div>
  );
}
