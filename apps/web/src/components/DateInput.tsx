'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { dayFirstToIso as toIso, isoToDayFirst as toDayFirst } from '@/lib/day-first';

/**
 * A date box that always reads day first (dd/mm/yyyy), as in Egypt, whatever language the
 * browser runs in; the browser's own date box follows the device and can show mm/dd. Forms
 * still get YYYY-MM-DD under `name`, and the calendar button opens the device's own picker.
 */
export function DateInput({
  name,
  value,
  defaultValue,
  onChange,
  max,
  className = '',
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: { target: { value: string } }) => void;
  max?: string;
  dir?: string;
  className?: string;
}) {
  const t = useTranslations('common');
  const [iso, setIso] = useState(value ?? defaultValue ?? '');
  const shown = value ?? iso;
  const [text, setText] = useState(toDayFirst(shown));
  const [lastShown, setLastShown] = useState(shown);
  const picker = useRef<HTMLInputElement>(null);
  if (shown !== lastShown) {
    // The parent changed the value (a controlled box): show it.
    setLastShown(shown);
    setText(toDayFirst(shown));
  }
  const bad = text.trim() !== '' && toIso(text) === null;

  function set(next: string) {
    setIso(next);
    setLastShown(next);
    onChange?.({ target: { value: next } });
  }

  return (
    <span dir="ltr" className="relative flex w-fit max-w-full items-center">
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        placeholder={t('datePlaceholder')}
        value={text}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const next = e.target.value.trim() === '' ? '' : toIso(e.target.value);
          if (next !== null) set(next);
        }}
        className={`${className} w-36 pe-10 ${bad ? 'border-danger' : ''}`}
      />
      {name && <input type="hidden" name={name} value={shown} />}
      <button
        type="button"
        aria-label={t('pickDate')}
        title={t('pickDate')}
        onClick={() => picker.current?.showPicker?.()}
        className="absolute end-1 flex h-8 w-8 items-center justify-center rounded text-text-muted hover:text-text"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={shown}
        max={max}
        onChange={(e) => {
          set(e.target.value);
          setText(toDayFirst(e.target.value));
        }}
        className="pointer-events-none absolute end-0 h-0 w-0 opacity-0"
      />
    </span>
  );
}
