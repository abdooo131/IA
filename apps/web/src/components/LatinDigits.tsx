'use client';

import { useEffect } from 'react';
import { latinInput, wantsLatinDigits } from '@/lib/digits';

/**
 * Turns digits typed on an Arabic keyboard into Latin digits in every number box (inputMode
 * numeric, decimal or tel, or type tel) as they are typed or pasted, before React reads the
 * value, so quantities, codes, phones, amounts and percents are never refused for them.
 */
export function LatinDigits() {
  useEffect(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const onInput = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLInputElement) || !wantsLatinDigits(el) || !setValue) return;
      let caret: number | null = null;
      try {
        caret = el.selectionStart;
      } catch {
        // Some input types have no caret.
      }
      const next = latinInput(el.value, caret);
      if (!next) return;
      // The prototype setter, so React still sees a change and calls onChange with it.
      setValue.call(el, next.value);
      if (next.caret !== null) {
        try {
          el.setSelectionRange(next.caret, next.caret);
        } catch {
          // Some input types have no caret.
        }
      }
    };
    // Capture on window runs before React's own listener on the document.
    window.addEventListener('input', onInput, true);
    return () => window.removeEventListener('input', onInput, true);
  }, []);
  return null;
}
