'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from './app-context';
import { Button, ErrorBox, Spinner } from './components';
import { IconPrinter } from './icons';

interface PdfRequest {
  title: string;
  fileName: string;
  path: string;
  init?: RequestInit;
  onLoaded?: () => void;
}

interface PdfState {
  open: (req: PdfRequest) => void;
}

const PdfCtx = createContext<PdfState | null>(null);

/**
 * Shows PDFs (AWB labels) inside the page instead of a pop up tab, which Safari blocks or blanks.
 * The viewer offers Print, Download and Open in new tab, so at least one path works in every browser.
 */
export function PdfViewerProvider({ children }: { children: ReactNode }) {
  const { api, t } = useApp();
  const [req, setReq] = useState<PdfRequest | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const close = useCallback(() => {
    setReq(null);
    setError(null);
    setUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
  }, []);

  const open = useCallback(
    (r: PdfRequest) => {
      setReq(r);
      setUrl(null);
      setError(null);
      api
        .blob(r.path, r.init)
        .then((b) => {
          setUrl(URL.createObjectURL(new Blob([b], { type: 'application/pdf' })));
          r.onLoaded?.();
        })
        .catch(setError);
    },
    [api],
  );

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, close]);

  function print() {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      if (url) window.open(url, '_blank');
    }
  }

  return (
    <PdfCtx.Provider value={{ open }}>
      {children}
      {req && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={req.title} data-testid="pdf-viewer">
          <div className="flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-lift">
            <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="me-auto font-display text-base font-semibold">{req.title}</h2>
              {url && (
                <>
                  <Button onClick={print} data-testid="pdf-print">
                    <IconPrinter width={16} height={16} /> {t.printLabel}
                  </Button>
                  <a className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-text ring-1 ring-inset ring-line hover:bg-paper" href={url} download={req.fileName} data-testid="pdf-download">
                    {t.download}
                  </a>
                  <a className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-text ring-1 ring-inset ring-line hover:bg-paper" href={url} target="_blank" rel="noreferrer">
                    {t.openNewTab}
                  </a>
                </>
              )}
              <Button variant="secondary" onClick={close} aria-label={t.close}>
                {t.close}
              </Button>
            </header>
            <div className="min-h-0 flex-1 bg-paper">
              {error ? (
                <div className="p-6"><ErrorBox error={error} /></div>
              ) : url ? (
                <iframe ref={frame} src={url} title={req.title} className="h-full w-full" data-testid="pdf-frame" />
              ) : (
                <Spinner />
              )}
            </div>
          </div>
        </div>
      )}
    </PdfCtx.Provider>
  );
}

export function usePdfViewer(): PdfState {
  const v = useContext(PdfCtx);
  if (!v) throw new Error('usePdfViewer outside PdfViewerProvider');
  return v;
}

/** Opens AWB labels for one or more orders in the in page viewer. */
export function useLabelPrinter() {
  const { open } = usePdfViewer();
  const { t } = useApp();
  return useCallback(
    (ids: string[], onLoaded?: () => void) =>
      open({
        title: `${t.printLabel} (${ids.length})`,
        fileName: ids.length === 1 ? `awb-${ids[0].slice(0, 8)}.pdf` : `awb-${ids.length}-labels.pdf`,
        path: '/orders/labels',
        init: { method: 'POST', body: JSON.stringify({ ids }), headers: { 'Content-Type': 'application/json' } },
        onLoaded,
      }),
    [open, t],
  );
}
