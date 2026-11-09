'use client';
// Confirmation dialogs for actions that cannot be undone, and success or error messages.
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

interface Ask {
  title: string;
  body: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

let showAsk: ((a: Ask) => void) | null = null;
let pushToast: ((t: Omit<Toast, 'id'>) => void) | null = null;

/** Texts are already translated by the caller. */
export function confirm(opts: { title: string; body: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => (showAsk ? showAsk({ ...opts, resolve }) : resolve(false)));
}
export const toast = {
  success: (text: string) => pushToast?.({ kind: 'success', text }),
  error: (text: string) => pushToast?.({ kind: 'error', text }),
};

export function FeedbackHost() {
  const t = useTranslations('common');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    showAsk = setAsk;
    let n = 0;
    pushToast = (x) => {
      const id = ++n;
      setToasts((all) => [...all, { ...x, id }]);
      setTimeout(() => setToasts((all) => all.filter((y) => y.id !== id)), 4000);
    };
    return () => {
      showAsk = null;
      pushToast = null;
    };
  }, []);
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };
  return (
    <>
      {ask && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ask-title">
            <h2 id="ask-title">{ask.title}</h2>
            <p>{ask.body}</p>
            <div className="dialog-actions">
              <button className="btn ghost" onClick={() => answer(false)}>
                {t('cancel')}
              </button>
              <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)} autoFocus>
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>
            {x.text}
          </div>
        ))}
      </div>
    </>
  );
}
