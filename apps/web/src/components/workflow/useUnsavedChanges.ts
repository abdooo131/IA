'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * While a form has changes that are not saved, leaving asks first: closing or reloading the
 * tab (the browser's own question) and following any link inside the app (ours).
 */
export function useUnsavedChanges(dirty: boolean) {
  const t = useTranslations('workflow');
  useEffect(() => {
    if (!dirty) return;
    const message = t('leaveConfirm');
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
    };
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty, t]);
}
