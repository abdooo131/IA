'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { shrinkPhoto, uploadPhoto } from '@/lib/photo';

/** Opens the phone camera, shrinks the photo, uploads it and reports its id. */
export function PhotoCapture({
  kind,
  label,
  onUploaded,
  onError,
}: {
  kind: 'pack' | 'delivery';
  label: string;
  onUploaded(id: string): void;
  onError(code: string): void;
}) {
  const t = useTranslations('orders.actions');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chosen(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const small = await shrinkPhoto(file).catch(() => file);
      setPreview(URL.createObjectURL(small));
      const result = await uploadPhoto(kind, small);
      if (result.ok) onUploaded(result.id);
      else onError(result.error);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={(e) => void chosen(e.target.files?.[0])}
      />
      {preview && (
        <img
          src={preview}
          alt=""
          className="max-h-56 rounded-md border border-line object-contain"
        />
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="h-12 w-full rounded-md bg-selected-bg px-4 font-bold text-link disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
      >
        {busy ? t('uploading') : preview ? t('retake') : label}
      </button>
    </div>
  );
}
