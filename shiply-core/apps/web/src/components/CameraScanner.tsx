'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';

// The phone's own barcode reader (Chrome on Android has it). Where it is missing, the button
// is hidden and people type the code or use a hand scanner.
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ['code_128', 'code_39', 'qr_code', 'ean_13', 'ean_8', 'upc_a', 'data_matrix'];

export function cameraScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}

/** Full screen camera that reads one code and hands it back. */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: FORMATS });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const look = async () => {
          if (stop || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const code = found.find((f) => f.rawValue.trim())?.rawValue.trim();
            if (code) {
              navigator.vibrate?.(80);
              onCode(code);
              return;
            }
          } catch {
            /* a frame that could not be read */
          }
          timer = setTimeout(look, 150);
        };
        void look();
      } catch {
        setError(t('Could not open the camera. Allow camera access, or type the code'));
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label={t('Scan with the camera')}>
      <div className="flex items-center justify-between p-4 text-white">
        <span className="text-body font-semibold">{t('Point the camera at the label')}</span>
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-pill bg-white/15" aria-label={t('Close')}>
          <span aria-hidden className="text-h2 leading-none">×</span>
        </button>
      </div>
      <div className="relative flex-1">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-40 -translate-y-1/2 rounded-xl border-4 border-shiply-lime/90" />
      </div>
      {error && <p className="bg-danger p-4 text-center text-body-sm font-semibold text-white">{error}</p>}
    </div>
  );
}
