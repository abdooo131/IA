'use client';

import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

const CameraScanner = dynamic(() => import('./CameraScanner'), { ssr: false });

/**
 * One input for every way staff enter codes: typing, a handheld scanner (it types the code
 * and presses Enter), or the phone camera. Keeps focus so the next scan just works.
 */
export function ScanBox({
  onCode,
  disabled,
  label,
  autoFocus = true,
}: {
  onCode(code: string): void;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations('scan');
  const [value, setValue] = useState('');
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = value.trim();
    if (!code) return;
    setValue('');
    onCode(code);
  }

  const fromCamera = useCallback(
    (code: string) => {
      setCamera(false);
      onCode(code.trim());
    },
    [onCode],
  );

  return (
    <>
      <form onSubmit={submit} className="flex gap-2">
        <label className="sr-only" htmlFor="scan-input">
          {label ?? t('placeholder')}
        </label>
        <input
          id="scan-input"
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          placeholder={label ?? t('placeholder')}
          className="h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-body text-text"
        />
        <button
          type="submit"
          disabled={disabled}
          className="h-12 rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
        >
          {t('submit')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCamera(true)}
          className="h-12 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('camera')}
        </button>
      </form>
      {camera && <CameraScanner onCode={fromCamera} onClose={() => setCamera(false)} />}
    </>
  );
}
